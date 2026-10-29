const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('./app');

async function withServer(run) {
  const { app } = createApi();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('API creates, reads, advances, and exposes audit history with REST status codes', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-actor': 'Isaac' },
      body: JSON.stringify({ institutionName: 'API Institute', region: 'West', instituteType: 'new' }),
    });
    assert.equal(created.status, 201);
    const { application } = await created.json();
    const fetched = await fetch(`${baseUrl}/api/applications/${application.id}`);
    assert.equal(fetched.status, 200);
    assert.equal((await fetched.json()).application.id, application.id);
    const advanced = await fetch(`${baseUrl}/api/applications/${application.id}/stage`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-actor': 'Isaac' },
      body: JSON.stringify({ action: 'approve' }),
    });
    assert.equal(advanced.status, 200);
    const transition = await advanced.json();
    assert.equal(transition.previousStage, 'Scrutiny');
    assert.equal(transition.newStage, 'Pending EVC');
    const audit = await fetch(`${baseUrl}/api/applications/${application.id}/audit`);
    assert.equal((await audit.json()).items.length, 2);
  });
});

test('API validates bad requests, reports missing records, and filters the application list', async () => {
  await withServer(async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ region: 'North' }),
    });
    assert.equal(invalid.status, 400);
    const missing = await fetch(`${baseUrl}/api/applications/no-such-id`);
    assert.equal(missing.status, 404);
    const list = await fetch(`${baseUrl}/api/applications?status=Approved&region=East`);
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), { items: [], total: 0 });
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal((await health.json()).status, 'ok');
  });
});

test('demo EVC scheduling and compliance evidence endpoints validate and update their records', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ institutionName: 'EVC Test College', region: 'South', instituteType: 'new' }),
    });
    const { application } = await created.json();
    await fetch(`${baseUrl}/api/applications/${application.id}/stage`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'approve' }),
    });
    const queue = await fetch(`${baseUrl}/api/evc/queue`);
    assert.ok((await queue.json()).items.some((item) => item.id === application.id));
    const scheduleResponse = await fetch(`${baseUrl}/api/evc/schedule`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ applicationId: application.id, scheduledAt: '2030-05-01T10:00:00Z', committee: 'South EVC' }),
    });
    assert.equal(scheduleResponse.status, 201);
    const duplicate = await fetch(`${baseUrl}/api/evc/schedule`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ applicationId: application.id, scheduledAt: '2030-05-01T10:00:00Z', committee: 'South EVC' }),
    });
    assert.equal(duplicate.status, 409);

    const undertakingResponse = await fetch(`${baseUrl}/api/applications/${application.id}/undertakings`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': 'Aaron' },
      body: JSON.stringify({ description: 'Renewed lease', dueDate: '2030-05-08' }),
    });
    assert.equal(undertakingResponse.status, 201);
    const { undertaking } = await undertakingResponse.json();
    const scopedItems = await (await fetch(`${baseUrl}/api/applications/${application.id}/undertakings`)).json();
    assert.equal(scopedItems.items[0].id, undertaking.id);
    const evidence = await fetch(`${baseUrl}/api/undertakings/${undertaking.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-actor': 'Aaron' },
      body: JSON.stringify({ evidence: 'Signed lease reviewed', documentType: 'Lease', mimeType: 'text/plain', expiryDate: '2031-05-08' }),
    });
    assert.equal(evidence.status, 200);
    assert.equal((await evidence.json()).undertaking.status, 'Fulfilled');
    const audit = await (await fetch(`${baseUrl}/api/applications/${application.id}/audit`)).json();
    assert.ok(audit.items.some((entry) => entry.action === 'compliance.undertaking.created'));
    assert.ok(audit.items.some((entry) => entry.action === 'compliance.evidence.validated'));
    const alerts = await (await fetch(`${baseUrl}/api/notifications`)).json();
    assert.ok(!alerts.items.some((alert) => alert.undertakingId === undertaking.id));
  });
});

test('compliance API rejects invalid due dates, evidence types, and evidence sizes', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ institutionName: 'Compliance College', region: 'West', instituteType: 'existing' }),
    });
    const { application } = await created.json();
    const badDate = await fetch(`${baseUrl}/api/applications/${application.id}/undertakings`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Renew lease', dueDate: '2030-02-30' }),
    });
    assert.equal(badDate.status, 400);
    const good = await fetch(`${baseUrl}/api/applications/${application.id}/undertakings`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Renew lease', dueDate: '2030-05-08' }),
    });
    const { undertaking } = await good.json();
    const badType = await fetch(`${baseUrl}/api/undertakings/${undertaking.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ evidence: 'Document uploaded', mimeType: 'application/x-msdownload' }),
    });
    assert.equal(badType.status, 400);
    const badSize = await fetch(`${baseUrl}/api/undertakings/${undertaking.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ evidence: 'Document uploaded', sizeBytes: 11 * 1024 * 1024 }),
    });
    assert.equal(badSize.status, 400);
  });
});
