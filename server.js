require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const { createApi } = require('./src/backend/app');
const { createPostgresRepository, runMigrations } = require('./src/backend/postgres-repository');
const { createInMemoryRepository } = require('./src/backend/repository');
const { RabbitMqEventPublisher, startOutboxDispatcher } = require('./src/backend/rabbitmq-publisher');

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
  const { app, workflow } = createApi({ repository });
  app.use(express.static(__dirname));

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
    if (dispatcher) await dispatcher.stop();
    if (pool) await pool.end();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { server, workflow, pool, dispatcher };
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Could not start the AICTE workflow app:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { start };
