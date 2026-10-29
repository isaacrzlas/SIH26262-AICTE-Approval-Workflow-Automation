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
