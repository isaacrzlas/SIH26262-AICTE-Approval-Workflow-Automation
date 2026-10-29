const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { createInMemoryRepository } = require('./repository');
const { ValidationError, NotFoundError, ConflictError } = require('./workflow-errors');

const TERMINAL_STATUSES = new Set(['Approved', 'Rejected']);

class LocalEventPublisher extends EventEmitter {
  constructor() {
    super();
    this.published = [];
  }

  publish(event) {
    this.published.push(event);
    this.emit(event.type, event);
    return event;
  }
}

function requiredText(value, field, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${field} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

function getPath(application) {
  return application.requiresEvc
    ? ['Scrutiny', 'Pending EVC', 'SAC / SHC', 'Approved']
    : ['Scrutiny', 'Approved'];
}

function statusForStage(stage) {
  if (stage === 'Pending EVC') return 'Pending EVC';
  if (stage === 'Approved') return 'Approved';
  return 'Under Review';
}

function createWorkflowService({
  clock = () => new Date(),
  idFactory = randomUUID,
  repository = createInMemoryRepository(),
  publisher = new LocalEventPublisher(),
} = {}) {
  function now() {
    return clock().toISOString();
  }

  function makeAudit(application, action, actor, details = {}) {
    return {
      id: idFactory(),
      applicationId: application.id,
      action,
      performedBy: actor,
      performedAt: now(),
      details,
    };
  }

  function makeEvent(type, payload) {
    return { id: idFactory(), type, occurredAt: now(), payload };
  }

  async function requireApplication(applicationId) {
    const application = await repository.getApplication(applicationId);
    if (!application) throw new NotFoundError(`Application ${applicationId} was not found`);
    return application;
  }

  async function saveTransition(application, action, actor, details, event = null) {
    const auditEntry = makeAudit(application, action, actor, details);
    application.auditLog.push(auditEntry);
    await repository.saveApplication(application, auditEntry, event);
    if (event) publisher.publish(event);
    return application;
  }

  async function createApplication(input = {}, actor = 'system') {
    const institutionName = requiredText(input.institutionName || input.name, 'institutionName');
    const region = requiredText(input.region, 'region', 80);
    const instituteType = input.instituteType || input.applicationType || 'existing';
    if (!['new', 'existing'].includes(instituteType)) {
      throw new ValidationError('instituteType must be "new" or "existing"');
    }

    const submittedAt = now();
    const application = {
      id: idFactory(),
      institutionName,
      region,
      instituteType,
      requiresEvc: instituteType === 'new',
      currentStage: 'Scrutiny',
      status: 'Under Review',
      submittedAt,
      lastUpdatedAt: submittedAt,
      version: 0,
      stageHistory: [{ stage: 'Scrutiny', enteredAt: submittedAt, completedAt: null, completedBy: null, reopenedAt: null }],
      auditLog: [],
    };
    const auditEntry = makeAudit(application, 'application.submitted', actor, { currentStage: application.currentStage, instituteType });
    application.auditLog.push(auditEntry);
    await repository.createApplication(application, auditEntry);
    return application;
  }

  async function listApplications(filters = {}) {
    return repository.listApplications(filters);
  }

  async function transition(applicationId, input = {}, actor = 'system') {
    const application = await requireApplication(applicationId);
    const action = input.action;
    if (!['approve', 'reject', 'revert', 'clarification'].includes(action)) {
      throw new ValidationError('action must be approve, reject, revert, or clarification');
    }
    if (TERMINAL_STATUSES.has(application.status)) {
      throw new ConflictError(`Application is already ${application.status.toLowerCase()}`);
    }

    const comment = typeof input.comments === 'string' ? input.comments.trim() : '';
    if (['revert', 'reject', 'clarification'].includes(action) && !comment) {
      throw new ValidationError(`comments are required when action is ${action}`);
    }

    const previousStage = application.currentStage;
    const timestamp = now();

    if (action === 'clarification') {
      application.status = 'Clarification Requested';
      application.lastUpdatedAt = timestamp;
      return saveTransition(application, 'application.clarification_requested', actor, { stage: previousStage, comments: comment });
    }

    if (action === 'reject') {
      application.status = 'Rejected';
      application.lastUpdatedAt = timestamp;
      const activeEntry = [...application.stageHistory].reverse().find((entry) => entry.stage === application.currentStage && !entry.revertedAt);
      if (activeEntry) {
        activeEntry.completedAt = timestamp;
        activeEntry.completedBy = actor;
      }
      const event = makeEvent('application.rejected', { applicationId, stage: previousStage, actor, comments: comment });
      return saveTransition(application, 'application.rejected', actor, { stage: previousStage, comments: comment }, event);
    }

    if (action === 'revert') {
      const workflowPath = getPath(application);
      const currentIndex = workflowPath.indexOf(application.currentStage);
      if (currentIndex <= 0) {
        throw new ConflictError('There is no previous stage to reopen');
      }
      const currentEntry = [...application.stageHistory].reverse().find((entry) => entry.stage === application.currentStage && !entry.revertedAt);
      const previousStage = workflowPath[currentIndex - 1];
      const reopenedEntry = [...application.stageHistory].reverse().find((entry) => entry.stage === previousStage && !entry.revertedAt);
      if (!currentEntry || !reopenedEntry) {
        throw new ConflictError('Stage history is incomplete; the previous stage cannot be reopened');
      }
      const revertedFrom = application.currentStage;
      currentEntry.revertedAt = timestamp;
      currentEntry.revertedBy = actor;
      reopenedEntry.completedAt = null;
      reopenedEntry.completedBy = null;
      reopenedEntry.reopenedAt = timestamp;
      application.currentStage = reopenedEntry.stage;
      application.status = statusForStage(reopenedEntry.stage);
      application.lastUpdatedAt = timestamp;
      const event = makeEvent('application.stage.reverted', { applicationId, from: revertedFrom, to: reopenedEntry.stage, actor, comments: comment });
      return saveTransition(application, 'application.stage_reverted', actor, { from: revertedFrom, to: reopenedEntry.stage, comments: comment }, event);
    }

    const workflowPath = getPath(application);
    const index = workflowPath.indexOf(application.currentStage);
    if (index < 0) throw new ConflictError(`Stage ${application.currentStage} is not valid for this workflow`);
    const currentEntry = [...application.stageHistory].reverse().find((entry) => entry.stage === application.currentStage && !entry.revertedAt);
    if (!currentEntry) throw new ConflictError('Current stage is missing from application history');
    currentEntry.completedAt = timestamp;
    currentEntry.completedBy = actor;
    const nextStage = workflowPath[index + 1] || 'Approved';
    application.currentStage = nextStage;
    application.status = statusForStage(nextStage);
    application.stageHistory.push({
      stage: nextStage,
      enteredAt: timestamp,
      completedAt: nextStage === 'Approved' ? timestamp : null,
      completedBy: nextStage === 'Approved' ? actor : null,
      reopenedAt: null,
    });
    application.lastUpdatedAt = timestamp;
    const event = makeEvent('application.stage.completed', {
      applicationId,
      from: previousStage,
      to: application.currentStage,
      status: application.status,
      actor,
    });
    return saveTransition(application, 'application.stage_completed', actor, { from: previousStage, to: application.currentStage, comments: comment || null }, event);
  }

  async function getApplication(applicationId) {
    return requireApplication(applicationId);
  }

  async function getAuditLog(applicationId) {
    return (await requireApplication(applicationId)).auditLog;
  }

  return { createApplication, listApplications, getApplication, getAuditLog, transition, publisher, repository };
}

module.exports = { ValidationError, NotFoundError, ConflictError, LocalEventPublisher, createWorkflowService };
