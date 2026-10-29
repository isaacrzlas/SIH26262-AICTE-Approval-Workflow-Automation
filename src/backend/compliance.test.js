const test = require('node:test');
const assert = require('node:assert/strict');
const { createComplianceService } = require('./compliance');
const { createWorkflowService } = require('./workflow');
const { createInMemoryRepository } = require('./repository');

function setup(initialDate = '2030-04-01T10:00:00.000Z') {
  let currentTime = initialDate;
  const clock = () => new Date(currentTime);
  const repository = createInMemoryRepository();
  const workflow = createWorkflowService({ repository, clock });
  const compliance = createComplianceService({ repository, clock });
  return { workflow, compliance, setTime(value) { currentTime = value; } };
}

async function createApplication(workflow) {
  return workflow.createApplication({ institutionName: 'Compliance Test Institute', region: 'South', instituteType: 'existing' }, 'Aaron');
}

test('due-date reminder fires three days before the deadline and is deduplicated', async () => {
  const { workflow, compliance } = setup();
  const application = await createApplication(workflow);
  const undertaking = await compliance.createUndertaking(application.id, {
    description: 'Submit renewed lease', dueDate: '2030-04-04',
  }, 'Aaron');

  assert.deepEqual(await compliance.runScheduledChecks(), { reminders: 1, escalations: 0, expiryReminders: 0 });
  assert.deepEqual(await compliance.runScheduledChecks(), { reminders: 0, escalations: 0, expiryReminders: 0 });
  const alerts = await compliance.listAlerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].undertakingId, undertaking.id);
  assert.equal(alerts[0].thresholdDays, 3);
});

test('missed deadline marks the undertaking overdue, records audit, and escalates once', async () => {
  const { workflow, compliance } = setup();
  const application = await createApplication(workflow);
  const undertaking = await compliance.createUndertaking(application.id, {
    description: 'Submit safety certificate', dueDate: '2030-03-31',
  }, 'Aaron');

  await compliance.runScheduledChecks();
  await compliance.runScheduledChecks();
  const items = await compliance.listUndertakings(application.id);
  assert.equal(items[0].status, 'Overdue');
  assert.equal((await compliance.listAlerts()).filter((item) => item.type === 'undertaking.overdue').length, 1);
  const audit = await workflow.getAuditLog(application.id);
  assert.ok(audit.some((entry) => entry.action === 'compliance.deadline.missed' && entry.details.undertakingId === undertaking.id));
});

test('validated document creates deduplicated 30-day and 15-day expiry alerts', async () => {
  const { workflow, compliance, setTime } = setup();
  const application = await createApplication(workflow);
  const undertaking = await compliance.createUndertaking(application.id, {
    description: 'Submit current lease', dueDate: '2030-08-01',
  }, 'Aaron');
  await compliance.submitEvidence(undertaking.id, {
    evidence: 'Signed lease reviewed', documentType: 'Lease', mimeType: 'application/pdf',
    sizeBytes: 1024, expiryDate: '2030-05-01',
  }, 'Aaron');

  await compliance.runScheduledChecks();
  await compliance.runScheduledChecks();
  setTime('2030-04-16T10:00:00.000Z');
  await compliance.runScheduledChecks();
  const alerts = (await compliance.listAlerts()).filter((item) => item.type === 'document.expiry');
  assert.deepEqual(alerts.map((item) => item.thresholdDays).sort((a, b) => b - a), [30, 15]);
});

test('evidence validation rejects unsupported document types, oversized files, and expired dates', async () => {
  const { workflow, compliance } = setup();
  const application = await createApplication(workflow);
  const undertaking = await compliance.createUndertaking(application.id, {
    description: 'Submit a document', dueDate: '2030-08-01',
  }, 'Aaron');
  await assert.rejects(() => compliance.submitEvidence(undertaking.id, {
    evidence: 'Uploaded item', mimeType: 'application/x-msdownload',
  }), /PDF, JPEG, PNG, or text/);
  await assert.rejects(() => compliance.submitEvidence(undertaking.id, {
    evidence: 'Uploaded item', sizeBytes: 10 * 1024 * 1024 + 1,
  }), /size must be between/);
  await assert.rejects(() => compliance.submitEvidence(undertaking.id, {
    evidence: 'Uploaded item', expiryDate: '2030-03-31',
  }), /expiryDate cannot be in the past/);
  assert.equal((await compliance.listUndertakings(application.id))[0].status, 'Open');
});

test('invalid calendar dates and missing application references are rejected', async () => {
  const { workflow, compliance } = setup();
  const application = await createApplication(workflow);
  await assert.rejects(() => compliance.createUndertaking(application.id, {
    description: 'Submit report', dueDate: '2030-02-29',
  }), /valid YYYY-MM-DD/);
  await assert.doesNotReject(() => compliance.createUndertaking(application.id, {
    description: 'Submit leap-year report', dueDate: '2032-02-29',
  }));
  await assert.rejects(() => compliance.listUndertakings('missing-application'), /was not found/);
});

test('same-day deadlines remain open through the due date and become overdue the next UTC day', async () => {
  const { workflow, compliance, setTime } = setup();
  const application = await createApplication(workflow);
  const undertaking = await compliance.createUndertaking(application.id, {
    description: 'Submit same-day report', dueDate: '2030-04-01',
  });
  await compliance.runScheduledChecks();
  assert.equal((await compliance.listUndertakings(application.id))[0].status, 'Open');
  setTime('2030-04-02T00:00:00.000Z');
  await compliance.runScheduledChecks();
  assert.equal((await compliance.listUndertakings(application.id))[0].status, 'Overdue');
  assert.ok((await compliance.listAlerts()).some((item) => item.undertakingId === undertaking.id && item.type === 'undertaking.overdue'));
});

test('scheduler yields to other event-loop work while checking a large queue', async () => {
  const { workflow, compliance } = setup();
  for (let index = 0; index < 250; index += 1) {
    const application = await createApplication(workflow);
    await compliance.createUndertaking(application.id, {
      description: `Future compliance item ${index}`, dueDate: '2030-12-31',
    });
  }
  let otherWorkRan = false;
  setImmediate(() => { otherWorkRan = true; });
  await compliance.runScheduledChecks();
  assert.equal(otherWorkRan, true);
});
