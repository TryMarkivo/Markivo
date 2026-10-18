const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate DB + secret BEFORE requiring the app (config reads env at load).
const TMP_DB = path.join(os.tmpdir(), `markivo-video-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = '';
// Room to make briefs (writing) and exactly TWO video renders, so the third
// exercises the exhausted-bucket path.
process.env.AI_LIMIT_FREEMIUM_WRITING = '30';
process.env.AI_LIMIT_FREEMIUM_VIDEO = '2';

const config = require('../config');
const mediagen = require('../mediagen');
const { app } = require('../server');
const createDb = require('../db');

let server, base, access, db;

const post = (p, body) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify(body || {}),
  });
const get = (p) => fetch(base + p, { headers: { Authorization: `Bearer ${access}` } });
const usage = async () => (await (await get('/api/usage')).json()).buckets;

/** Create a full-mode video brief and return its media id. */
const newVideoBrief = async () =>
  (await (await post('/api/media/brief', { kind: 'video', mode: 'full', topic: 'a slow pan across the counter' })).json()).id;

// Swap mediagen's transport for the duration of one test. The route calls
// mediagen directly, so the seam is the module's own exports.
function stubEngine({ start, poll, download }) {
  const original = {
    startVideo: mediagen.startVideo,
    pollVideo: mediagen.pollVideo,
    downloadVideo: mediagen.downloadVideo,
  };
  if (start) mediagen.startVideo = start;
  if (poll) mediagen.pollVideo = poll;
  if (download) mediagen.downloadVideo = download;
  return () => Object.assign(mediagen, original);
}

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db = createDb(config.dbPath);

  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `vid${Date.now()}@m.uz`, password: 'secret123', fullName: 'V' }),
  });
  access = (await reg.json()).accessToken;
  await post('/api/onboarding/construct', { businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop' });
  // The engine is only "live" for the stubs below; the key is never used.
  config.geminiApiKey = 'test_gemini_key';
});

after(() => {
  config.geminiApiKey = '';
  db.close();
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

test('a video render is accepted as a job, not awaited inline', async () => {
  const id = await newVideoBrief();
  const before = (await usage()).video.used;

  const restore = stubEngine({ start: async () => ({ operationId: 'operations/job-1' }) });
  try {
    const res = await post(`/api/media/${id}/render`);
    // 202, not 200: generation takes minutes, so holding the request open would
    // simply time out.
    assert.strictEqual(res.status, 202);
    assert.deepStrictEqual(await res.json(), { id, status: 'rendering' });
  } finally { restore(); }

  // Charged at SUBMIT, because that is when the spend is committed upstream.
  assert.strictEqual((await usage()).video.used, before + 1);
  const row = db.media.findById(id);
  assert.strictEqual(row.status, 'rendering');
  assert.strictEqual(row.operationId, 'operations/job-1');
  assert.ok(row.renderStartedAt);
});

test('polling reports progress and saves the file once the job finishes', async () => {
  const id = db.media.listByProfile(db.profiles.findByUserId(
    (await (await get('/api/auth/me')).json()).id
  ).id).find((m) => m.status === 'rendering').id;

  let restore = stubEngine({ poll: async () => ({ done: false }) });
  try {
    const pending = await (await get(`/api/media/${id}/status`)).json();
    assert.deepStrictEqual(pending, { id, status: 'rendering' });
  } finally { restore(); }

  const bytes = Buffer.from('fake-mp4-bytes');
  const uploads = path.join(__dirname, '..', 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  const name = `video-test-${Date.now()}.mp4`;
  fs.writeFileSync(path.join(uploads, name), bytes);

  restore = stubEngine({
    poll: async () => ({ done: true, uri: 'https://v/out.mp4' }),
    download: async () => ({ filePath: `/uploads/${name}` }),
  });
  try {
    const done = await (await get(`/api/media/${id}/status`)).json();
    assert.strictEqual(done.status, 'rendered');
    assert.strictEqual(done.url, `/uploads/${name}`);
  } finally {
    restore();
    try { fs.unlinkSync(path.join(uploads, name)); } catch { /* ignore */ }
  }

  const row = db.media.findById(id);
  assert.strictEqual(row.status, 'rendered');
  assert.strictEqual(row.filePath, `uploads/${name}`, 'stored without the leading slash');
  assert.strictEqual(row.operationId, null, 'the finished job releases its handle');
});

test('a failed job refunds the unit — charged for output that never arrived', async () => {
  const id = await newVideoBrief();
  let restore = stubEngine({ start: async () => ({ operationId: 'operations/job-doomed' }) });
  try { await post(`/api/media/${id}/render`); } finally { restore(); }

  const charged = (await usage()).video.used;

  restore = stubEngine({ poll: async () => ({ done: true, error: 'blocked by a safety filter' }) });
  try {
    const res = await (await get(`/api/media/${id}/status`)).json();
    assert.strictEqual(res.status, 'failed');
    assert.match(res.error, /safety filter/);
  } finally { restore(); }

  assert.strictEqual((await usage()).video.used, charged - 1, 'the unit came back');
  assert.strictEqual(db.media.findById(id).status, 'failed');
});

test('a network blip while polling does NOT destroy a paid-for render', async () => {
  const id = await newVideoBrief();
  let restore = stubEngine({ start: async () => ({ operationId: 'operations/job-flaky' }) });
  try { await post(`/api/media/${id}/render`); } finally { restore(); }

  const charged = (await usage()).video.used;

  // Failing to ASK is not the job failing. Treating it as failure would refund
  // a unit for a video that is still generating, and mark it dead on arrival.
  restore = stubEngine({
    poll: async () => { throw new mediagen.MediaEngineError(502, 'Media engine unreachable: socket hang up'); },
  });
  try {
    const res = await (await get(`/api/media/${id}/status`)).json();
    assert.strictEqual(res.status, 'rendering', 'still in flight, not failed');
  } finally { restore(); }

  assert.strictEqual((await usage()).video.used, charged, 'no spurious refund');
  assert.strictEqual(db.media.findById(id).status, 'rendering');

  // …and the retry that follows still succeeds.
  restore = stubEngine({
    poll: async () => ({ done: true, error: 'gave up' }),
  });
  try { await get(`/api/media/${id}/status`); } finally { restore(); }
  assert.strictEqual(db.media.findById(id).status, 'failed');
});

test('a render already in flight is not started twice', async () => {
  const id = await newVideoBrief();
  let restore = stubEngine({ start: async () => ({ operationId: 'operations/job-dup' }) });
  try {
    assert.strictEqual((await post(`/api/media/${id}/render`)).status, 202);
    const again = await post(`/api/media/${id}/render`);
    assert.strictEqual(again.status, 409);
    assert.match((await again.json()).error, /already being generated/i);
  } finally { restore(); }

  // One charge, not two — a double-click must not cost twice.
  assert.strictEqual((await usage()).video.used, 2);
});

test('an exhausted video bucket blocks the render before any spend', async () => {
  const id = await newVideoBrief();
  const spentBefore = (await usage()).video.used;
  assert.strictEqual(spentBefore, 2, 'the allowance is used up by now');

  let started = false;
  const restore = stubEngine({ start: async () => { started = true; return { operationId: 'x' }; } });
  try {
    const res = await post(`/api/media/${id}/render`);
    assert.strictEqual(res.status, 429);
    const data = await res.json();
    assert.strictEqual(data.bucket, 'video');
    assert.match(data.error, /used all 2 video generations/i);
  } finally { restore(); }

  assert.strictEqual(started, false, 'the engine was never called');
  assert.strictEqual((await usage()).video.used, spentBefore, 'a rejected render costs nothing');
});

test('the stale sweep fails and refunds a job nobody is polling', async () => {
  const { runStaleRenderSweep } = require('../server');
  const id = await newVideoBrief();

  // Charge and park the row directly: the bucket is exhausted above, and this
  // test is about the sweep, not the budget.
  const userId = (await (await get('/api/auth/me')).json()).id;
  db.usage.record({ userId, kind: 'media_video', bucket: 'video' });
  const charged = db.usage.countThisWeek(userId, 'video');
  db.media.update(id, {
    operationId: 'operations/abandoned',
    status: 'rendering',
    // Started long enough ago to be past veoMaxWaitMs.
    renderStartedAt: new Date(Date.now() - config.veoMaxWaitMs - 60000).toISOString(),
  });

  await runStaleRenderSweep();

  assert.strictEqual(db.media.findById(id).status, 'failed');
  assert.strictEqual(db.usage.countThisWeek(userId, 'video'), charged - 1, 'refunded');
});

test('a job still within its window is settled, not failed, by the sweep', async () => {
  const { runStaleRenderSweep } = require('../server');
  const id = await newVideoBrief();
  db.media.update(id, {
    operationId: 'operations/still-going',
    status: 'rendering',
    renderStartedAt: new Date().toISOString(),
  });

  const restore = stubEngine({ poll: async () => ({ done: false }) });
  try {
    await runStaleRenderSweep();
  } finally { restore(); }

  assert.strictEqual(db.media.findById(id).status, 'rendering', 'a young job is left alone');
});
