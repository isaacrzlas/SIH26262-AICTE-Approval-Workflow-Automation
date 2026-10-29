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
