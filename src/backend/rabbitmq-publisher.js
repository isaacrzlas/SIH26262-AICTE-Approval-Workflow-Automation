class RabbitMqEventPublisher {
  constructor(url, queueName = 'aicte.workflow.events', amqpClient = null) {
    this.url = url;
    this.queueName = queueName;
    this.amqpClient = amqpClient;
    this.connection = null;
    this.channel = null;
  }

  async connect() {
    if (this.channel) return;
    const amqp = this.amqpClient || require('amqplib');
    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createConfirmChannel();
    await this.channel.assertQueue(this.queueName, { durable: true });
  }

  async publish(event) {
    await this.connect();
    this.channel.sendToQueue(this.queueName, Buffer.from(JSON.stringify(event)), {
      persistent: true,
      contentType: 'application/json',
      messageId: event.id,
      type: event.type,
      timestamp: Math.floor(Date.parse(event.occurredAt) / 1000),
    });
    await this.channel.waitForConfirms();
  }

  async close() {
    if (this.channel) await this.channel.close();
    if (this.connection) await this.connection.close();
    this.channel = null;
    this.connection = null;
  }
}

function startOutboxDispatcher(repository, publisher, { intervalMs = 1500, onError = (error) => console.error('Outbox dispatch failed:', error.message) } = {}) {
  let running = false;

  async function dispatchPending() {
    if (running) return;
    running = true;
    try {
      const events = await repository.getPendingEvents(50);
      for (const event of events) {
        await publisher.publish(event);
        await repository.markEventDelivered(event.id);
      }
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(dispatchPending, intervalMs);
  timer.unref();
  const ready = dispatchPending();
  return {
    dispatchPending,
    ready,
    async stop() {
      clearInterval(timer);
      await publisher.close();
    },
  };
}

module.exports = { RabbitMqEventPublisher, startOutboxDispatcher };
