const { NotFoundError } = require('./workflow-errors');

function createInMemoryRepository() {
  const applications = new Map();
  const outbox = new Map();
  const undertakings = new Map();
  const complianceDocs = new Map();
  const complianceAlerts = new Map();

  function appendAudit(auditEntry) {
    const application = applications.get(auditEntry.applicationId);
    if (!application) throw new NotFoundError(`Application ${auditEntry.applicationId} was not found`);
    application.auditLog ||= [];
    application.auditLog.push(auditEntry);
  }

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
    async listUndertakings(applicationId = null) {
      return [...undertakings.values()].filter((item) => !applicationId || item.applicationId === applicationId);
    },
    async getUndertaking(undertakingId) {
      return undertakings.get(undertakingId) || null;
    },
    async createUndertaking(undertaking, auditEntry) {
      if (!applications.has(undertaking.applicationId)) throw new NotFoundError(`Application ${undertaking.applicationId} was not found`);
      undertakings.set(undertaking.id, undertaking);
      appendAudit(auditEntry);
      return undertaking;
    },
    async saveUndertaking(undertaking, auditEntry) {
      if (!undertakings.has(undertaking.id)) throw new NotFoundError(`Undertaking ${undertaking.id} was not found`);
      undertakings.set(undertaking.id, undertaking);
      appendAudit(auditEntry);
      return undertaking;
    },
    async listComplianceDocs(applicationId = null) {
      return [...complianceDocs.values()].filter((item) => !applicationId || item.applicationId === applicationId);
    },
    async createComplianceDoc(document, auditEntry) {
      if (!applications.has(document.applicationId)) throw new NotFoundError(`Application ${document.applicationId} was not found`);
      complianceDocs.set(document.id, document);
      appendAudit(auditEntry);
      return document;
    },
    async completeUndertaking(undertaking, document, auditEntries) {
      if (!undertakings.has(undertaking.id)) throw new NotFoundError(`Undertaking ${undertaking.id} was not found`);
      complianceDocs.set(document.id, document);
      undertakings.set(undertaking.id, undertaking);
      for (const auditEntry of auditEntries) appendAudit(auditEntry);
    },
    async saveComplianceAlert(alert, event) {
      if (complianceAlerts.has(alert.dedupeKey)) return false;
      complianceAlerts.set(alert.dedupeKey, alert);
      if (event) outbox.set(event.id, { ...event, deliveredAt: null });
      return true;
    },
    async listComplianceAlerts() {
      return [...complianceAlerts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  };
}

module.exports = { createInMemoryRepository };
