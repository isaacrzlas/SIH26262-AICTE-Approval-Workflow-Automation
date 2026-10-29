const { NotFoundError } = require('./workflow-errors');

function createInMemoryRepository() {
  const applications = new Map();
  const outbox = new Map();

  return {
    async createApplication(application) {
      applications.set(application.id, application);
    },
    async getApplication(applicationId) {
      return applications.get(applicationId) || null;
    },
    async listApplications(filters = {}) {
      const status = typeof filters.status === 'string' ? filters.status.trim().toLowerCase() : '';
      const region = typeof filters.region === 'string' ? filters.region.trim().toLowerCase() : '';
      const query = typeof filters.search === 'string' ? filters.search.trim().toLowerCase() : '';
      return [...applications.values()].filter((application) => {
        return (!status || application.status.toLowerCase() === status)
          && (!region || application.region.toLowerCase() === region)
          && (!query || application.institutionName.toLowerCase().includes(query) || application.id.toLowerCase().includes(query));
      });
    },
    async saveApplication(application, _auditEntry, event) {
      if (!applications.has(application.id)) throw new NotFoundError(`Application ${application.id} was not found`);
      applications.set(application.id, application);
      if (event) outbox.set(event.id, { ...event, deliveredAt: null });
    },
    async getPendingEvents(limit = 50) {
      return [...outbox.values()].filter((event) => !event.deliveredAt).slice(0, limit);
    },
    async markEventDelivered(eventId, deliveredAt = new Date().toISOString()) {
      const event = outbox.get(eventId);
      if (event) event.deliveredAt = deliveredAt;
    },
  };
}

module.exports = { createInMemoryRepository };
