const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkflowService, ValidationError, ConflictError, NotFoundError } = require('./workflow');

function makeService() {
  let id = 0;
  let tick = 0;
  return createWorkflowService({
    idFactory: () => `id-${++id}`,
    clock: () => new Date(Date.UTC(2026, 9, 29, 10, 0, tick++)),
  });
}

async function submit(service, instituteType = 'existing') {
  return service.createApplication({ institutionName: 'Test Institute', region: 'South', instituteType }, 'Isaac');
}

test('submission defaults to scrutiny and writes a submission audit record', async () => {
  const service = makeService();
  const application = await service.createApplication({ name: 'Institute A', region: 'North' }, 'Isaac');
  assert.equal(application.currentStage, 'Scrutiny');
  assert.equal(application.status, 'Under Review');
  assert.equal(application.instituteType, 'existing');
  assert.equal(application.stageHistory.length, 1);
  assert.equal(application.auditLog[0].action, 'application.submitted');
  assert.equal(application.auditLog[0].performedBy, 'Isaac');
});

test('existing institute scrutiny-only route ends approved', async () => {
  const service = makeService();
  const application = await submit(service);
  const result = await service.transition(application.id, { action: 'approve' }, 'Reviewer');
  assert.equal(result.currentStage, 'Approved');
  assert.equal(result.status, 'Approved');
  assert.deepEqual(result.stageHistory.map((entry) => entry.stage), ['Scrutiny', 'Approved']);
  assert.equal(result.auditLog.at(-1).details.to, 'Approved');
});

test('new institute follows scrutiny, EVC, SAC/SHC, then approval and publishes stage events', async () => {
  const service = makeService();
  const application = await submit(service, 'new');
  assert.equal(application.requiresEvc, true);
  await service.transition(application.id, { action: 'approve' }, 'Scrutiny Officer');
  assert.equal(application.currentStage, 'Pending EVC');
  await service.transition(application.id, { action: 'approve' }, 'EVC Member');
  assert.equal(application.currentStage, 'SAC / SHC');
  await service.transition(application.id, { action: 'approve' }, 'Committee Member');
  assert.equal(application.currentStage, 'Approved');
  assert.deepEqual(application.stageHistory.map((entry) => entry.stage), ['Scrutiny', 'Pending EVC', 'SAC / SHC', 'Approved']);
  assert.equal(service.publisher.published.length, 3);
  assert.ok(service.publisher.published.every((event) => event.type === 'application.stage.completed'));
  assert.equal((await service.repository.getPendingEvents()).length, 3);
});

test('revert requires a reason, reopens previous stage, and stores the reason in audit', async () => {
  const service = makeService();
  const application = await submit(service, 'new');
  await service.transition(application.id, { action: 'approve' }, 'Reviewer');
  await assert.rejects(() => service.transition(application.id, { action: 'revert' }, 'Reviewer'), ValidationError);
  const result = await service.transition(application.id, { action: 'revert', comments: 'EVC documents need correction' }, 'Reviewer');
  assert.equal(result.currentStage, 'Scrutiny');
  assert.equal(result.stageHistory[0].completedAt, null);
  assert.ok(result.stageHistory[0].reopenedAt);
  assert.equal(result.auditLog.at(-1).details.comments, 'EVC documents need correction');
});

test('reverting and then advancing again preserves the correct previous-stage relationship', async () => {
  const service = makeService();
  const application = await submit(service, 'new');
  await service.transition(application.id, { action: 'approve' }, 'Reviewer');
  await service.transition(application.id, { action: 'revert', comments: 'Recheck scrutiny' }, 'Reviewer');
  await service.transition(application.id, { action: 'approve' }, 'Reviewer');
  assert.equal(application.currentStage, 'Pending EVC');
  await service.transition(application.id, { action: 'revert', comments: 'EVC package incomplete' }, 'Reviewer');
  assert.equal(application.currentStage, 'Scrutiny');
  assert.equal(application.auditLog.at(-1).details.to, 'Scrutiny');
});

test('clarification is auditable and the reviewer can continue the same stage afterward', async () => {
  const service = makeService();
  const application = await submit(service);
  await service.transition(application.id, { action: 'clarification', comments: 'Please provide the signed form' }, 'Reviewer');
  assert.equal(application.status, 'Clarification Requested');
  assert.equal(application.currentStage, 'Scrutiny');
  assert.equal(application.auditLog.at(-1).details.comments, 'Please provide the signed form');
  await service.transition(application.id, { action: 'approve', comments: 'Updated form received' }, 'Reviewer');
  assert.equal(application.status, 'Approved');
});

test('reject requires a comment and makes the application terminal', async () => {
  const service = makeService();
  const application = await submit(service);
  await assert.rejects(() => service.transition(application.id, { action: 'reject' }, 'Reviewer'), ValidationError);
  await service.transition(application.id, { action: 'reject', comments: 'Eligibility criteria not met' }, 'Reviewer');
  assert.equal(application.status, 'Rejected');
  assert.equal(application.auditLog.at(-1).action, 'application.rejected');
  await assert.rejects(() => service.transition(application.id, { action: 'approve' }, 'Reviewer'), ConflictError);
});

test('validates application fields and action names', async () => {
  const service = makeService();
  await assert.rejects(() => service.createApplication({ region: 'East' }), ValidationError);
  await assert.rejects(() => service.createApplication({ institutionName: 'A', region: 'East', instituteType: 'unknown' }), ValidationError);
  const application = await submit(service);
  await assert.rejects(() => service.transition(application.id, { action: 'skip' }), ValidationError);
});

test('prevents reverting the first stage and reports missing applications', async () => {
  const service = makeService();
  const application = await submit(service);
  await assert.rejects(() => service.transition(application.id, { action: 'revert', comments: 'Fix' }), ConflictError);
  await assert.rejects(() => service.getApplication('absent'), NotFoundError);
  await assert.rejects(() => service.getAuditLog('absent'), NotFoundError);
});

test('lists applications by status, region, and text search', async () => {
  const service = makeService();
  await submit(service, 'new');
  const existing = await submit(service);
  await service.transition(existing.id, { action: 'approve' });
  assert.equal((await service.listApplications({ status: 'approved' })).length, 1);
  assert.equal((await service.listApplications({ region: 'south', search: 'test institute' })).length, 2);
  assert.equal((await service.listApplications({ search: 'id-1' })).length, 1);
});
