const test = require('node:test');
const assert = require('node:assert/strict');
const { createPostgresRepository, runMigrations } = require('./postgres-repository');
const { ConflictError } = require('./workflow-errors');

const applicationId = '70000000-0000-4000-8000-000000000001';
const auditId = '70000000-0000-4000-8000-000000000002';
const eventId = '70000000-0000-4000-8000-000000000003';
const appRow = {
  id: applicationId,
  institution_name: 'Stored Institute',
  region: 'East',
  institute_type: 'new',
  requires_evc: true,
  current_stage: 'Pending EVC',
  status: 'Pending EVC',
  submitted_at: new Date('2026-10-29T10:00:00.000Z'),
  last_updated_at: new Date('2026-10-29T10:01:00.000Z'),
  version: 1,
};

function createFakePool({ staleVersion = false } = {}) {
  const calls = [];
  const pool = {
    calls,
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM applications')) return { rows: [appRow], rowCount: 1 };
      if (sql.includes('FROM application_stages')) {
        return { rows: [{ stage_name: 'Scrutiny', entered_at: appRow.submitted_at, completed_at: appRow.last_updated_at, completed_by: 'Isaac', reopened_at: null, reverted_at: null, reverted_by: null }], rowCount: 1 };
      }
      if (sql.includes('FROM audit_logs')) {
        return { rows: [{ id: auditId, entity_id: applicationId, action: 'application.submitted', performed_by: 'Isaac', performed_at: appRow.submitted_at, details: { currentStage: 'Scrutiny' } }], rowCount: 1 };
      }
      if (sql.includes('FROM event_outbox')) {
        return { rows: [{ id: eventId, event_type: 'application.stage.completed', occurred_at: appRow.last_updated_at, payload: { applicationId } }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    async connect() {
      return {
        async query(sql) {
          calls.push(sql);
          if (sql.includes('UPDATE applications')) return { rows: [], rowCount: staleVersion ? 0 : 1 };
          if (sql.includes('SELECT 1 FROM applications')) return { rows: [{}], rowCount: 1 };
          return { rows: [], rowCount: 1 };
        },
        release() {},
      };
    },
  };
  return pool;
}

test('PostgreSQL adapter maps persisted application, stage, and audit rows', async () => {
  const repository = createPostgresRepository(createFakePool());
  const application = await repository.getApplication(applicationId);
  assert.equal(application.institutionName, 'Stored Institute');
  assert.equal(application.version, 1);
  assert.equal(application.stageHistory[0].stage, 'Scrutiny');
  assert.equal(application.auditLog[0].performedBy, 'Isaac');
  const list = await repository.listApplications({ status: 'Pending EVC', region: 'East', search: 'Stored' });
  assert.equal(list[0].id, applicationId);
});

test('PostgreSQL adapter writes application changes, audit, stages, and event in transactions', async () => {
  const pool = createFakePool();
  const repository = createPostgresRepository(pool);
  const application = {
    id: applicationId, institutionName: 'Stored Institute', region: 'East', instituteType: 'new', requiresEvc: true,
    currentStage: 'Pending EVC', status: 'Pending EVC', submittedAt: appRow.submitted_at.toISOString(),
    lastUpdatedAt: appRow.last_updated_at.toISOString(), version: 0,
    stageHistory: [{ stage: 'Scrutiny', enteredAt: appRow.submitted_at.toISOString(), completedAt: null, completedBy: null, reopenedAt: null }],
  };
  const audit = { id: auditId, applicationId, action: 'stage.completed', performedBy: 'Isaac', performedAt: appRow.last_updated_at.toISOString(), details: { to: 'Pending EVC' } };
  const event = { id: eventId, type: 'application.stage.completed', occurredAt: appRow.last_updated_at.toISOString(), payload: { applicationId } };
  await repository.createApplication(application, audit);
  await repository.saveApplication(application, audit, event);
  assert.equal(pool.calls.filter((sql) => sql === 'BEGIN').length, 2);
  assert.equal(pool.calls.filter((sql) => sql === 'COMMIT').length, 2);
  assert.ok(pool.calls.some((sql) => sql.includes('INSERT INTO audit_logs')));
  assert.ok(pool.calls.some((sql) => sql.includes('INSERT INTO event_outbox')));
  assert.equal(application.version, 1);
  assert.equal((await repository.getPendingEvents())[0].id, eventId);
  await repository.markEventDelivered(eventId);
});

test('PostgreSQL adapter rejects stale concurrent writes', async () => {
  const repository = createPostgresRepository(createFakePool({ staleVersion: true }));
  await assert.rejects(() => repository.saveApplication({
    id: applicationId, institutionName: 'Stored Institute', region: 'East', instituteType: 'new', requiresEvc: true,
    currentStage: 'Pending EVC', status: 'Pending EVC', submittedAt: appRow.submitted_at.toISOString(),
    lastUpdatedAt: appRow.last_updated_at.toISOString(), version: 0, stageHistory: [],
  }, { id: auditId }, null), ConflictError);
});

test('database migration runner applies the checked-in schema', async () => {
  let sql;
  await runMigrations({ async query(statement) { sql = statement; } });
  assert.match(sql, /CREATE TABLE IF NOT EXISTS applications/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS audit_logs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS event_outbox/);
});
