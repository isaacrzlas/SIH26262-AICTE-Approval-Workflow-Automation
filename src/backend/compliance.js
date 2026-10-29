const { randomUUID } = require('node:crypto');
const { ValidationError, NotFoundError, ConflictError } = require('./workflow-errors');

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EVIDENCE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'text/plain']);

function dateOnly(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`${field} must be a valid YYYY-MM-DD date`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`${field} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

function requiredText(value, field, maxLength = 500) {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} is required`);
  const result = value.trim();
  if (result.length > maxLength) throw new ValidationError(`${field} must be ${maxLength} characters or fewer`);
  return result;
}

function utcToday(clock) {
  return clock().toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function createComplianceService({ repository, clock = () => new Date(), idFactory = randomUUID } = {}) {
  if (!repository) throw new TypeError('A repository is required');

  function audit(applicationId, action, actor, details) {
    return { id: idFactory(), applicationId, action, performedBy: actor, performedAt: clock().toISOString(), details };
  }

  async function requireApplication(applicationId) {
    if (typeof applicationId !== 'string' || !applicationId.trim()) throw new ValidationError('applicationId is required');
    const application = await repository.getApplication(applicationId);
    if (!application) throw new NotFoundError(`Application ${applicationId} was not found`);
    return application;
  }

  async function listUndertakings(applicationId) {
    await requireApplication(applicationId);
    return repository.listUndertakings(applicationId);
  }

  async function listAllUndertakings() {
    return repository.listUndertakings();
  }

  async function createUndertaking(applicationId, input = {}, actor = 'demo-reviewer') {
    const application = await requireApplication(applicationId);
    const description = requiredText(input.description, 'description');
    const requiredAction = input.requiredAction == null ? description : requiredText(input.requiredAction, 'requiredAction');
    const dueDate = dateOnly(input.dueDate, 'dueDate');
    const createdAt = clock().toISOString();
    const undertaking = {
      id: idFactory(), applicationId, institutionName: application.institutionName, region: application.region,
      description, requiredAction, dueDate, status: 'Open', createdBy: actor,
      createdAt, updatedAt: createdAt, fulfilledAt: null, evidence: null,
    };
    const entry = audit(applicationId, 'compliance.undertaking.created', actor, {
      undertakingId: undertaking.id, description, requiredAction, dueDate,
    });
    await repository.createUndertaking(undertaking, entry);
    return undertaking;
  }

  async function submitEvidence(undertakingId, input = {}, actor = 'demo-reviewer') {
    const undertaking = await repository.getUndertaking(undertakingId);
    if (!undertaking) throw new NotFoundError(`Undertaking ${undertakingId} was not found`);
    if (undertaking.status === 'Fulfilled') throw new ConflictError('Undertaking is already fulfilled');

    const documentInput = input.document && typeof input.document === 'object' ? input.document : input;
    const evidence = requiredText(input.evidence ?? documentInput.description, 'evidence', 500);
    const documentType = requiredText(documentInput.documentType || 'Evidence description', 'documentType', 120);
    const mimeType = documentInput.mimeType || 'text/plain';
    if (!ALLOWED_EVIDENCE_TYPES.has(mimeType)) {
      throw new ValidationError('Evidence must be a PDF, JPEG, PNG, or text document');
    }
    const sizeBytes = documentInput.sizeBytes == null ? Buffer.byteLength(evidence, 'utf8') : Number(documentInput.sizeBytes);
    if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_EVIDENCE_BYTES) {
      throw new ValidationError('Evidence size must be between 1 byte and 10 MB');
    }
    const expiryDate = documentInput.expiryDate == null || documentInput.expiryDate === ''
      ? null
      : dateOnly(documentInput.expiryDate, 'expiryDate');
    if (expiryDate && expiryDate < utcToday(clock)) throw new ValidationError('expiryDate cannot be in the past');

    const submittedAt = clock().toISOString();
    const document = {
      id: idFactory(), applicationId: undertaking.applicationId, undertakingId,
      documentType, expiryDate, storageKey: documentInput.storageKey || null,
      mimeType, sizeBytes, validationStatus: 'Valid', submittedBy: actor,
      submittedAt, validatedBy: actor, validatedAt: submittedAt,
    };
    const updatedUndertaking = {
      ...undertaking, evidence, status: 'Fulfilled', fulfilledAt: submittedAt, updatedAt: submittedAt,
    };
    const entry = audit(undertaking.applicationId, 'compliance.evidence.validated', actor, {
      undertakingId, complianceDocId: document.id, documentType, mimeType, sizeBytes, expiryDate,
    });
    const updateEntry = audit(undertaking.applicationId, 'compliance.undertaking.fulfilled', actor, {
      undertakingId, complianceDocId: document.id,
    });
    await repository.completeUndertaking(updatedUndertaking, document, [entry, updateEntry]);
    return { undertaking: updatedUndertaking, document };
  }

  async function createAlert({ applicationId, undertakingId = null, complianceDocId = null, type, thresholdDays = null, dedupeKey, message }) {
    const createdAt = clock().toISOString();
    const alert = { id: idFactory(), applicationId, undertakingId, complianceDocId, type, thresholdDays, dedupeKey, message, createdAt };
    const targetRole = type === 'undertaking.overdue' ? 'admins' : 'institution';
    const event = { id: idFactory(), type: `compliance.${type}`, occurredAt: createdAt, payload: { ...alert, targetRole } };
    return repository.saveComplianceAlert(alert, event);
  }

  async function runScheduledChecks() {
    const today = utcToday(clock);
    const undertakings = await repository.listUndertakings();
    const documents = await repository.listComplianceDocs();
    const results = { reminders: 0, escalations: 0, expiryReminders: 0 };
    let processed = 0;
    async function yieldForOtherWork() {
      processed += 1;
      if (processed % 100 === 0) await new Promise((resolve) => setImmediate(resolve));
    }

    for (const item of undertakings) {
      if (item.status === 'Fulfilled') { await yieldForOtherWork(); continue; }
      const daysUntil = daysBetween(today, item.dueDate);
      let current = item;
      if (item.status === 'Open' && daysUntil < 0) {
        const updatedAt = clock().toISOString();
        const overdue = { ...item, status: 'Overdue', updatedAt };
        const entry = audit(item.applicationId, 'compliance.deadline.missed', 'compliance-scheduler', {
          undertakingId: item.id, dueDate: item.dueDate,
        });
        await repository.saveUndertaking(overdue, entry);
        current = overdue;
      }
      if (current.status === 'Overdue') {
        const saved = await createAlert({
          applicationId: item.applicationId, undertakingId: item.id, type: 'undertaking.overdue',
          dedupeKey: `undertaking:${item.id}:overdue`,
          message: `Overdue: ${item.description} · ${item.institutionName}`,
        });
        if (saved) results.escalations += 1;
      } else if (current.status === 'Open' && daysUntil === 3) {
        const saved = await createAlert({
          applicationId: item.applicationId, undertakingId: item.id, type: 'undertaking.reminder', thresholdDays: 3,
          dedupeKey: `undertaking:${item.id}:due-3-days`,
          message: `Due in 3 days: ${item.description} · ${item.institutionName}`,
        });
        if (saved) results.reminders += 1;
      }
      await yieldForOtherWork();
    }

    for (const document of documents) {
      if (!document.expiryDate || document.validationStatus !== 'Valid') { await yieldForOtherWork(); continue; }
      const daysUntil = daysBetween(today, document.expiryDate);
      const thresholds = [30, 15].filter((threshold) => threshold === 30
        ? daysUntil <= 30 && daysUntil > 15
        : daysUntil <= 15 && daysUntil >= 0);
      for (const threshold of thresholds) {
        const saved = await createAlert({
          applicationId: document.applicationId, complianceDocId: document.id, type: 'document.expiry',
          thresholdDays: threshold, dedupeKey: `document:${document.id}:expiry-${threshold}-days`,
          message: `${document.documentType} expires in ${daysUntil} days`,
        });
        if (saved) results.expiryReminders += 1;
      }
      await yieldForOtherWork();
    }
    return results;
  }

  async function listAlerts() {
    return repository.listComplianceAlerts();
  }

  return { listUndertakings, listAllUndertakings, createUndertaking, submitEvidence, runScheduledChecks, listAlerts };
}

function startComplianceScheduler(compliance, { intervalMs = 24 * 60 * 60 * 1000, onError = (error) => console.error('Compliance scheduler failed:', error) } = {}) {
  let stopped = false;
  const run = () => compliance.runScheduledChecks().catch(onError);
  void run();
  const timer = setInterval(() => { if (!stopped) void run(); }, intervalMs);
  timer.unref?.();
  return { stop() { stopped = true; clearInterval(timer); } };
}

module.exports = { createComplianceService, startComplianceScheduler, dateOnly, daysBetween, MAX_EVIDENCE_BYTES };
