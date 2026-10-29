const test = require('node:test');
const assert = require('node:assert/strict');
const { RabbitMqEventPublisher, startOutboxDispatcher } = require('./rabbitmq-publisher');

test('RabbitMQ publisher declares a durable queue and waits for broker confirmation', async () => {
  const calls = [];
  const channel = {
    async assertQueue(name, options) { calls.push(['assertQueue', name, options]); },
    sendToQueue(name, body, options) { calls.push(['sendToQueue', name, JSON.parse(body.toString()), options]); },
    async waitForConfirms() { calls.push(['waitForConfirms']); },
    async close() { calls.push(['channel.close']); },
  };
  const connection = {
    async createConfirmChannel() { return channel; },
    async close() { calls.push(['connection.close']); },
  };
  const publisher = new RabbitMqEventPublisher('amqp://test', 'events.test', {
    async connect(url) { calls.push(['connect', url]); return connection; },
  });
  const event = { id: 'event-1', type: 'application.stage.completed', occurredAt: '2026-10-29T10:00:00.000Z', payload: { applicationId: 'app-1' } };
  await publisher.publish(event);
  await publisher.close();
  assert.ok(calls.some(([name, queue, options]) => name === 'assertQueue' && queue === 'events.test' && options.durable));
  assert.ok(calls.some(([name, , , options]) => name === 'sendToQueue' && options.persistent));
  assert.ok(calls.some(([name]) => name === 'waitForConfirms'));
  assert.ok(calls.some(([name]) => name === 'connection.close'));
});

test('outbox dispatcher delivers queued events then marks them delivered', async () => {
  const event = { id: 'event-1', type: 'application.stage.completed', occurredAt: '2026-10-29T10:00:00.000Z', payload: { applicationId: 'app-1' } };
  const pending = [event];
  const delivered = [];
  const sent = [];
  const repository = {
    async getPendingEvents() { return pending.filter((item) => !delivered.includes(item.id)); },
    async markEventDelivered(id) { delivered.push(id); },
  };
  const publisher = {
    async publish(item) { sent.push(item); },
    async close() {},
  };

  const dispatcher = startOutboxDispatcher(repository, publisher, { intervalMs: 60000 });
  await dispatcher.ready;
  await dispatcher.stop();
  assert.deepEqual(sent.map((item) => item.id), ['event-1']);
  assert.deepEqual(delivered, ['event-1']);
});

test('outbox dispatcher leaves a failed event pending and reports the broker error', async () => {
  const event = { id: 'event-2', type: 'application.stage.completed', occurredAt: '2026-10-29T10:00:00.000Z', payload: {} };
  const delivered = [];
  const errors = [];
  const repository = {
    async getPendingEvents() { return delivered.includes(event.id) ? [] : [event]; },
    async markEventDelivered(id) { delivered.push(id); },
  };
  const publisher = {
    async publish() { throw new Error('broker offline'); },
    async close() {},
  };
  const dispatcher = startOutboxDispatcher(repository, publisher, { intervalMs: 60000, onError: (error) => errors.push(error.message) });
  await dispatcher.ready;
  await dispatcher.stop();
  assert.deepEqual(delivered, []);
  assert.deepEqual(errors, ['broker offline']);
});
