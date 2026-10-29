const express = require('express');
const {
  ValidationError,
  NotFoundError,
  ConflictError,
  createWorkflowService,
} = require('./workflow');

function createApi({ workflow, repository, publisher } = {}) {
  workflow ||= createWorkflowService({ repository, publisher });
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
  const undertakings = [
    { id: 'UND-1042', applicationId: 'AICTE-2026-0147', institutionName: 'Northstar College of Engineering', region: 'North', description: 'Submit updated fire safety certificate', dueDate: '2026-11-02', status: 'Open', evidence: null },
    { id: 'UND-1038', applicationId: 'AICTE-2026-0145', institutionName: 'Riverbend Polytechnic', region: 'East', description: 'Upload faculty appointment records', dueDate: '2026-10-31', status: 'Open', evidence: null },
    { id: 'UND-1027', applicationId: 'AICTE-2026-0144', institutionName: 'Meridian Institute of Technology', region: 'Central', description: 'Renew building occupancy certificate', dueDate: '2026-10-28', status: 'Overdue', evidence: null },
  ];

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
  app.get('/api/undertakings', (_request, response) => response.json({ items: undertakings }));
  app.post('/api/undertakings', (request, response) => {
    const { applicationId, institutionName, region, description, dueDate } = request.body || {};
    if (![applicationId, institutionName, region, description].every((value) => typeof value === 'string' && value.trim()) || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate || '') || Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`))) {
      return response.status(400).json({ error: 'Application, institution, region, description, and valid due date are required' });
    }
    const item = { id: `UND-${Date.now()}`, applicationId: applicationId.trim(), institutionName: institutionName.trim(), region: region.trim(), description: description.trim(), dueDate, status: 'Open', evidence: null };
    undertakings.unshift(item);
    response.status(201).json({ undertaking: item });
  });
  app.put('/api/undertakings/:id', (request, response) => {
    const item = undertakings.find((entry) => entry.id === request.params.id);
    if (!item) return response.status(404).json({ error: 'Undertaking was not found' });
    const evidence = request.body?.evidence;
    if (typeof evidence !== 'string' || !evidence.trim() || evidence.trim().length > 500) return response.status(400).json({ error: 'Evidence description is required and must be 500 characters or fewer' });
    item.evidence = evidence.trim();
    item.status = 'Fulfilled';
    item.fulfilledAt = new Date().toISOString();
    response.json({ undertaking: item });
  });
  app.get('/api/notifications', (_request, response) => {
    const items = undertakings.filter((item) => item.status !== 'Fulfilled').map((item) => ({ id: `alert-${item.id}`, type: item.status === 'Overdue' ? 'Overdue' : 'Due soon', message: `${item.description} · ${item.institutionName}`, dueDate: item.dueDate, undertakingId: item.id }));
    response.json({ items });
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

  return { app, workflow };
}

module.exports = { createApi };
