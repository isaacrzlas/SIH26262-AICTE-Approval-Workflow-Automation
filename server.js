require('dotenv').config();

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { createApi } = require('./src/backend/app');
const { createPostgresRepository, runMigrations } = require('./src/backend/postgres-repository');
const { createInMemoryRepository } = require('./src/backend/repository');
const { RabbitMqEventPublisher, startOutboxDispatcher } = require('./src/backend/rabbitmq-publisher');
const { startComplianceScheduler } = require('./src/backend/compliance');

async function start() {
  let pool = null;
  let dispatcher = null;
  if (process.env.DATABASE_URL) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await runMigrations(pool);
    console.log('PostgreSQL workflow schema is ready.');
  } else {
    console.warn('DATABASE_URL is unset; using temporary in-memory application storage.');
  }

  const repository = pool ? createPostgresRepository(pool) : createInMemoryRepository();
  const { app, workflow, compliance } = createApi({ repository });
  if ((!pool || process.env.DEMO_SEED === 'true') && (await workflow.listApplications()).length === 0) {
    const samples = [
      ['Eastern Valley Institute of Technology', 'South', 'existing'],
      ['Northstar College of Engineering', 'North', 'new'],
      ['Lotus School of Architecture', 'West', 'existing'],
      ['Riverbend Polytechnic', 'East', 'new'],
      ['Meridian Institute of Technology', 'Central', 'existing'],
    ];
    for (const [institutionName, region, instituteType] of samples) {
      let application = await workflow.createApplication({ institutionName, region, instituteType }, 'demo-seed');
      const targetStages = instituteType === 'new' ? 1 : 0;
      for (let step = 0; step < targetStages; step += 1) application = await workflow.transition(application.id, { action: 'approve' }, 'demo-seed');
    }
    console.log('Loaded five local demo applications.');
  }
  const complianceScheduler = startComplianceScheduler(compliance);
  const frontendRoot = fs.existsSync(path.join(__dirname, 'dist')) ? path.join(__dirname, 'dist') : __dirname;
  app.use(express.static(frontendRoot));
  app.get('/{*path}', (request, response, next) => {
    if (request.path.startsWith('/api/')) return next();
    response.sendFile(path.join(frontendRoot, 'index.html'));
  });

  if (process.env.AMQP_URL) {
    const publisher = new RabbitMqEventPublisher(process.env.AMQP_URL);
    dispatcher = startOutboxDispatcher(repository, publisher);
    console.log('RabbitMQ outbox dispatcher is active.');
  } else {
    console.warn('AMQP_URL is unset; workflow events remain in the local outbox.');
  }

  const port = Number(process.env.PORT) || 4173;
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`AICTE Workflow preview and API: http://127.0.0.1:${port}`);
  });

  async function shutdown() {
    server.close();
    complianceScheduler.stop();
    if (dispatcher) await dispatcher.stop();
    if (pool) await pool.end();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { server, workflow, compliance, complianceScheduler, pool, dispatcher };
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Could not start the AICTE workflow app:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { start };
