const express = require('express');
const {
  ValidationError,
  NotFoundError,
  ConflictError,
  createWorkflowService,
} = require('./workflow');
const { createComplianceService } = require('./compliance');

function createApi({ workflow, repository, publisher, clock, idFactory } = {}) {
  workflow ||= createWorkflowService({ repository, publisher });
  const compliance = createComplianceService({ repository: workflow.repository, clock, idFactory });
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb', strict: true }));

  // Lightweight per-process protection for the local prototype. Production needs a
  // shared rate limiter at the edge and real authentication/RBAC.
  const rateBuckets = new Map();
  app.use('/api', (request, response, next) => {
    const now = Date.now();
    const key = request.ip || 'local';
    const bucket = rateBuckets.get(key) || { start: now, count: 0 };
    if (now - bucket.start >= 60_000) { bucket.start = now; bucket.count = 0; }
    bucket.count += 1;
    rateBuckets.set(key, bucket);
    response.set('RateLimit-Limit', '120');
    response.set('RateLimit-Remaining', String(Math.max(0, 120 - bucket.count)));
    if (bucket.count > 120) return response.status(429).json({ error: 'Too many requests. Try again in a minute.' });
    next();
  });

  const evcSchedules = [];
  app.get('/api/evc/queue', async (_request, response, next) => {
    try {
      const items = await workflow.listApplications({ status: 'Pending EVC' });
      response.json({ items: items.map((item) => ({ ...item, schedule: evcSchedules.find((schedule) => schedule.applicationId === item.id) || null })) });
    } catch (error) { next(error); }
  });
  app.post('/api/evc/schedule', (request, response) => {
    const { applicationId, scheduledAt, committee } = request.body || {};
    if (typeof applicationId !== 'string' || !applicationId || !Number.isFinite(Date.parse(scheduledAt)) || typeof committee !== 'string' || !committee.trim()) {
      return response.status(400).json({ error: 'applicationId, valid scheduledAt, and committee are required' });
    }
    if (evcSchedules.some((item) => item.applicationId === applicationId)) return response.status(409).json({ error: 'This application already has an EVC schedule' });
    const schedule = { id: `EVC-${Date.now()}`, applicationId, scheduledAt: new Date(scheduledAt).toISOString(), committee: committee.trim(), status: 'Scheduled' };
    evcSchedules.push(schedule);
    response.status(201).json({ schedule });
  });
  app.get('/api/applications/:id/undertakings', async (request, response, next) => {
    try { response.json({ items: await compliance.listUndertakings(request.params.id) }); }
    catch (error) { next(error); }
  });
  app.post('/api/applications/:id/undertakings', async (request, response, next) => {
    try {
      const actor = request.get('x-actor') || 'demo-reviewer';
      const undertaking = await compliance.createUndertaking(request.params.id, request.body, actor);
      response.status(201).json({ undertaking });
    } catch (error) { next(error); }
  });
  app.get('/api/applications/:id/compliance-docs', async (request, response, next) => {
    try {
      const application = await workflow.getApplication(request.params.id);
      const items = await workflow.repository.listComplianceDocs(request.params.id);
      if (!application) return response.status(404).json({ error: 'Application was not found' });
      response.json({ items });
    } catch (error) { next(error); }
  });
  app.get('/api/undertakings', async (_request, response, next) => {
    try { response.json({ items: await compliance.listAllUndertakings() }); }
    catch (error) { next(error); }
  });
  app.post('/api/undertakings', async (request, response, next) => {
    try {
      const actor = request.get('x-actor') || 'demo-reviewer';
      const undertaking = await compliance.createUndertaking(request.body?.applicationId, request.body, actor);
      response.status(201).json({ undertaking });
    } catch (error) { next(error); }
  });
  app.put('/api/undertakings/:id', async (request, response, next) => {
    try {
      const actor = request.get('x-actor') || 'demo-reviewer';
      const result = await compliance.submitEvidence(request.params.id, request.body, actor);
      response.json(result);
    } catch (error) { next(error); }
  });
  app.get('/api/notifications', async (_request, response, next) => {
    try { response.json({ items: await compliance.listAlerts() }); }
    catch (error) { next(error); }
  });

  app.get('/api/health', (_request, response) => response.json({
    status: 'ok',
    persistence: process.env.DATABASE_URL ? 'postgres' : 'memory',
    messaging: process.env.AMQP_URL ? 'rabbitmq-outbox' : 'local-events',
  }));

  app.get('/api/applications', async (request, response) => {
    const items = await workflow.listApplications({
      status: request.query.status,
      region: request.query.region,
      search: request.query.search,
    });
    response.json({ items, total: items.length });
  });

  app.post('/api/applications', async (request, response, next) => {
    try {
      const actor = request.get('x-actor') || 'demo-reviewer';
      const application = await workflow.createApplication(request.body, actor);
      response.status(201).json({ application });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/applications/:id', async (request, response, next) => {
    try {
      response.json({ application: await workflow.getApplication(request.params.id) });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/applications/:id/stage', async (request, response, next) => {
    try {
      const actor = request.get('x-actor') || 'demo-reviewer';
      const previousStage = (await workflow.getApplication(request.params.id)).currentStage;
      const application = await workflow.transition(request.params.id, request.body, actor);
      response.json({
        applicationId: application.id,
        previousStage,
        newStage: application.currentStage,
        status: application.status,
        message: `Application moved to ${application.currentStage}`,
        application,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/applications/:id/audit', async (request, response, next) => {
    try {
      response.json({ items: await workflow.getAuditLog(request.params.id) });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof SyntaxError && Object.prototype.hasOwnProperty.call(error, 'body')) {
      return response.status(400).json({ error: 'Request body must be valid JSON' });
    }
    if (error instanceof ValidationError || error instanceof NotFoundError || error instanceof ConflictError) {
      return response.status(error.statusCode).json({ error: error.message });
    }
    if (error.type === 'entity.too.large') {
      return response.status(413).json({ error: 'Request body exceeds the 100kb limit' });
    }
    return response.status(500).json({ error: 'Internal server error' });
  });

  return { app, workflow, compliance };
}

module.exports = { createApi };
