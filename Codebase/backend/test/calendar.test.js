const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the test DB + secret BEFORE requiring the app (config reads env at load).
const TMP_DB = path.join(os.tmpdir(), `markivo-calendar-test-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';

const { app } = require('../server');

const post = (p, body, token) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const patch = (p, body, token) =>
  fetch(base + p, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const get = (p, token) => fetch(base + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const del = (p, token) => fetch(base + p, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} });

let server, base, token;
const NEXT_WEEK = new Date(Date.now() + 7 * 86400000).toISOString();

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const email = `cal${Date.now()}@markivo.uz`;
  const reg = await (await post('/api/auth/register', { email, password: 'secret123', fullName: 'Calendar Owner' })).json();
  token = reg.accessToken;
  await post('/api/onboarding/construct', {
    businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop', tone: 'Cozy & Warm',
    platforms: { instagram: true },
  }, token);
});
after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

let eventId;

test('GET /api/calendar/events returns a Google-Calendar-shaped feed', async () => {
  await post('/api/content/schedule', {
    platform: 'instagram', postText: 'Weekend special ✨', scheduledTime: NEXT_WEEK,
  }, token);

  const res = await get('/api/calendar/events', token);
  assert.strictEqual(res.status, 200);
  const data = await res.json();

  assert.strictEqual(data.kind, 'calendar#events');
  assert.ok(data.summary.includes('Noir Cafe'));
  assert.ok(Array.isArray(data.items) && data.items.length >= 1);

  const ev = data.items.find((e) => e.description === 'Weekend special ✨');
  assert.ok(ev, 'the scheduled post appears as an event');
  eventId = ev.id;
  assert.strictEqual(ev.kind, 'calendar#event');
  assert.strictEqual(ev.status, 'confirmed');
  assert.strictEqual(ev.start.dateTime, NEXT_WEEK);
  assert.ok(ev.end.dateTime > ev.start.dateTime, 'events have a non-zero span');
  assert.strictEqual(ev.extendedProperties.private.source, 'scheduled_post');
  assert.strictEqual(ev.extendedProperties.private.platform, 'instagram');
});

test('timeMin/timeMax filter the window', async () => {
  const past = `timeMin=${encodeURIComponent(new Date(Date.now() - 60 * 86400000).toISOString())}` +
    `&timeMax=${encodeURIComponent(new Date(Date.now() - 30 * 86400000).toISOString())}`;
  const empty = await (await get(`/api/calendar/events?${past}`, token)).json();
  assert.strictEqual(empty.items.length, 0);

  const wide = await (await get(`/api/calendar/events?timeMin=${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}`, token)).json();
  assert.ok(wide.items.length >= 1);
});

test('PATCH moves a scheduled post to a new time', async () => {
  const moved = new Date(Date.now() + 10 * 86400000).toISOString();
  const res = await patch(`/api/calendar/events/${eventId}`, { start: { dateTime: moved } }, token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).start.dateTime, moved);
});

test('PATCH rejects a bad date and read-only Autopilot history', async () => {
  assert.strictEqual((await patch(`/api/calendar/events/${eventId}`, { start: { dateTime: 'not-a-date' } }, token)).status, 400);
  // Autopilot activity ids are namespaced auto_* and can never be edited.
  assert.strictEqual((await patch('/api/calendar/events/auto_abc', { start: { dateTime: NEXT_WEEK } }, token)).status, 400);
  assert.strictEqual((await del('/api/calendar/events/auto_abc', token)).status, 400);
});

test('events are scoped to the owning profile', async () => {
  const email = `other${Date.now()}@markivo.uz`;
  const reg = await (await post('/api/auth/register', { email, password: 'secret123', fullName: 'Other' })).json();
  await post('/api/onboarding/construct', {
    businessName: 'Other Spot', category: 'Cafe / Coffee Shop', tone: 'Cozy & Warm', platforms: { instagram: true },
  }, reg.accessToken);

  // Onboarding seeds each new profile with its own starter posts, so the check
  // is that NONE of this business's events belong to the other one.
  const theirs = await (await get('/api/calendar/events', reg.accessToken)).json();
  assert.ok(theirs.summary.includes('Other Spot'));
  assert.ok(!theirs.items.some((e) => e.id === eventId));
  assert.ok(!theirs.items.some((e) => e.description === 'Weekend special ✨'));
  assert.strictEqual((await patch(`/api/calendar/events/${eventId}`, { start: { dateTime: NEXT_WEEK } }, reg.accessToken)).status, 404);
  assert.strictEqual((await del(`/api/calendar/events/${eventId}`, reg.accessToken)).status, 404);
});

test('DELETE cancels a scheduled post, and an already-posted one cannot be moved', async () => {
  // A post that already went out is history, not a plan.
  await post('/api/content/post-now', { platform: 'instagram', postText: 'Already out' }, token);
  const items = (await (await get('/api/calendar/events', token)).json()).items;
  const posted = items.find((e) => e.description === 'Already out');
  assert.ok(posted);
  assert.strictEqual((await patch(`/api/calendar/events/${posted.id}`, { start: { dateTime: NEXT_WEEK } }, token)).status, 400);
  assert.strictEqual((await del(`/api/calendar/events/${posted.id}`, token)).status, 400);

  assert.strictEqual((await del(`/api/calendar/events/${eventId}`, token)).status, 200);
  const after = (await (await get('/api/calendar/events', token)).json()).items;
  assert.ok(!after.some((e) => e.id === eventId));
});

test('/api/calendar requires a session', async () => {
  assert.strictEqual((await get('/api/calendar/events')).status, 401);
});
