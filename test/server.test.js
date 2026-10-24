import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebhookServer, isAuthorized } from '../src/server.js';

const SECRET = 'super-secret-value-123';
const silent = { debug() {}, info() {}, warn() {}, error() {} };

async function withServer(onPendingRequest, fn) {
  const server = createWebhookServer({ secret: SECRET, onPendingRequest, logger: silent });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

const post = (base, body, headers = {}) =>
  fetch(`${base}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('isAuthorized accepts raw and Bearer forms, rejects others', () => {
  assert.equal(isAuthorized(SECRET, SECRET), true);
  assert.equal(isAuthorized(`Bearer ${SECRET}`, SECRET), true);
  assert.equal(isAuthorized('nope', SECRET), false);
  assert.equal(isAuthorized(undefined, SECRET), false);
  assert.equal(isAuthorized('', SECRET), false);
});

test('rejects webhooks without the secret', async () => {
  let called = false;
  await withServer(async () => { called = true; }, async (base) => {
    assert.equal((await post(base, { notification_type: 'MEDIA_PENDING' })).status, 401);
    assert.equal((await post(base, { notification_type: 'MEDIA_PENDING' }, { Authorization: 'wrong' })).status, 401);
  });
  assert.equal(called, false);
});

test('forwards MEDIA_PENDING when authorized', async () => {
  const seen = [];
  await withServer(async (p) => { seen.push(p); }, async (base) => {
    const res = await post(base, { notification_type: 'MEDIA_PENDING', subject: 'Dune' }, { Authorization: SECRET });
    assert.equal(res.status, 200);
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].subject, 'Dune');
});

test('acknowledges but ignores other notification types (e.g. Test button)', async () => {
  let called = false;
  await withServer(async () => { called = true; }, async (base) => {
    const res = await post(base, { notification_type: 'TEST_NOTIFICATION' }, { Authorization: SECRET });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ignored');
  });
  assert.equal(called, false);
});

test('returns 400 for bad JSON and 413 for oversized bodies', async () => {
  await withServer(async () => {}, async (base) => {
    assert.equal((await post(base, '{not json', { Authorization: SECRET })).status, 400);
    assert.equal((await post(base, '[1,2]', { Authorization: SECRET })).status, 400);
    const big = JSON.stringify({ notification_type: 'MEDIA_PENDING', pad: 'x'.repeat(100_000) });
    const res = await post(base, big, { Authorization: SECRET }).catch(() => ({ status: 413 }));
    assert.equal(res.status, 413);
  });
});

test('returns 502 when posting to Discord fails, without leaking details', async () => {
  await withServer(async () => { throw new Error('token abc123 exploded'); }, async (base) => {
    const res = await post(base, { notification_type: 'MEDIA_PENDING' }, { Authorization: SECRET });
    assert.equal(res.status, 502);
    assert.doesNotMatch(JSON.stringify(await res.json()), /abc123/);
  });
});

test('health endpoint and unknown routes', async () => {
  await withServer(async () => {}, async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/webhook`)).status, 405);
  });
});
