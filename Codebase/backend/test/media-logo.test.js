const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the test DB + secret BEFORE requiring the app (config reads env at load).
// Both text-engine keys are pinned to '' here so dotenv cannot fill them from a
// .env on disk → media briefs, edit plans, and logos always run keyless and the
// assertions below describe the deterministic templates, not a live model.
const TMP_DB = path.join(os.tmpdir(), `markivo-media-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = '';
// This file makes many text generations in sequence; the default weekly
// writing bucket is deliberately small, so give it headroom.
process.env.AI_LIMIT_FREEMIUM_WRITING = '30';

const { app } = require('../server');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
// A valid 1x1 transparent PNG.
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// Mirror of the strict SVG sanitizer the AI layer enforces.
const DANGEROUS_SVG = /<script|<foreignObject|javascript:|on[a-z]+=|href=/i;

let server, base, access;
const uploadedFiles = [];

const post = (p, body) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify(body),
  });
const get = (p) => fetch(base + p, { headers: { Authorization: `Bearer ${access}` } });

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `media${Date.now()}@m.uz`, password: 'secret123', fullName: 'M' }),
  });
  access = (await reg.json()).accessToken;
  // Deliberately NOT a cafe — personalization must derive from this profile.
  await post('/api/onboarding/construct', {
    businessName: 'Atlas Repair',
    category: 'Phone Repair',
    tone: 'Professional & Trustworthy',
    description: 'Fast phone and laptop repair with same-day service in Chilanzar',
    audience: 'students and office workers',
  });
});

after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`, ...uploadedFiles]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

let guidedId;

test('guided VIDEO brief is a full production plan', async () => {
  const res = await post('/api/media/brief', { kind: 'video', mode: 'guided', topic: 'screen replacement before and after' });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(data.id);
  guidedId = data.id;
  const b = data.brief;
  assert.strictEqual(b.mode, 'guided');
  assert.strictEqual(b.kind, 'video');

  // The video-only half: story, flow, and a timed spoken script.
  assert.ok(typeof b.scenario === 'string' && b.scenario.length > 0);
  assert.ok(typeof b.flow === 'string' && b.flow.length > 0);
  assert.ok(Array.isArray(b.script) && b.script.length >= 2);
  for (const line of b.script) {
    assert.ok(typeof line.time === 'string' && line.time.length > 0);
  }

  // Staging + camera, the way a videographer would specify them.
  assert.ok(Array.isArray(b.setup) && b.setup.length >= 3);
  for (const field of ['device', 'lens', 'settings', 'whiteBalance', 'stabilisation']) {
    assert.ok(typeof b.camera[field] === 'string' && b.camera[field].length > 0, `camera.${field}`);
  }

  // Every shot names its framing, angle, MOVEMENT and duration.
  assert.ok(Array.isArray(b.shotList) && b.shotList.length >= 5);
  for (const shot of b.shotList) {
    for (const field of ['name', 'framing', 'angle', 'movement', 'duration', 'direction']) {
      assert.ok(typeof shot[field] === 'string' && shot[field].length > 0, `shot.${field}`);
    }
  }

  assert.ok(Array.isArray(b.bRoll) && b.bRoll.length >= 1);
  assert.ok(Array.isArray(b.transitions) && b.transitions.length >= 1);
  assert.ok(typeof b.audio === 'string' && b.audio.length > 0);
  assert.ok(typeof b.postProcessing === 'string' && b.postProcessing.length > 0);
  assert.ok(Array.isArray(b.tips) && b.tips.length >= 1);
});

test('guided PHOTO brief drops the video-only sections', async () => {
  const res = await post('/api/media/brief', { kind: 'image', mode: 'guided', topic: 'our new seasonal latte' });
  assert.strictEqual(res.status, 200);
  const b = (await res.json()).brief;
  assert.strictEqual(b.kind, 'image');

  // A photo shoot has no scenario, script, or camera movement.
  assert.strictEqual(b.scenario, undefined);
  assert.strictEqual(b.script, undefined);
  assert.strictEqual(b.shotList[0].movement, undefined);

  // But it still carries the photographer's setup, camera, and framing.
  assert.ok(typeof b.scene === 'string' && b.scene.length > 0);
  assert.ok(Array.isArray(b.setup) && b.setup.length >= 3);
  assert.ok(typeof b.composition === 'string' && b.composition.length > 0);
  assert.ok(typeof b.camera.lens === 'string' && b.camera.lens.length > 0);
  for (const shot of b.shotList) {
    for (const field of ['name', 'framing', 'angle', 'direction']) {
      assert.ok(typeof shot[field] === 'string' && shot[field].length > 0, `shot.${field}`);
    }
  }
});

test('full media brief reports the engine as awaiting a media API key', async () => {
  const res = await post('/api/media/brief', { kind: 'image', mode: 'full', topic: 'summer discount banner' });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.brief.engineStatus, 'awaiting_media_api');
  assert.ok(typeof data.brief.concept === 'string' && data.brief.concept.length > 0);
  assert.ok(typeof data.brief.caption === 'string' && data.brief.caption.includes('#'));
});

test('media brief validates kind, mode, and topic', async () => {
  assert.strictEqual((await post('/api/media/brief', { kind: 'gif', mode: 'guided', topic: 'hello there' })).status, 400);
  assert.strictEqual((await post('/api/media/brief', { kind: 'image', mode: 'auto', topic: 'hello there' })).status, 400);
  assert.strictEqual((await post('/api/media/brief', { kind: 'image', mode: 'full', topic: 'x' })).status, 400);
});

test('upload roundtrip: PNG data URL saves a file and appears in the media list', async () => {
  const res = await post('/api/media/upload', { filename: 'pixel.png', dataUrl: `data:image/png;base64,${PNG_1PX}` });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(data.id);
  assert.match(data.url, /^\/uploads\/[0-9a-f-]+\.png$/);

  const onDisk = path.join(UPLOADS_DIR, path.basename(data.url));
  uploadedFiles.push(onDisk);
  assert.ok(fs.existsSync(onDisk), 'uploaded file exists on disk');

  const list = await (await get('/api/media')).json();
  const item = list.items.find((m) => m.id === data.id);
  assert.ok(item, 'upload appears in the media list');
  assert.strictEqual(item.status, 'uploaded');
  assert.strictEqual(item.kind, 'image');
});

test('upload rejects non-media data URLs', async () => {
  const res = await post('/api/media/upload', {
    filename: 'evil.html',
    dataUrl: 'data:text/html;base64,PGh0bWw+PC9odG1sPg==',
  });
  assert.strictEqual(res.status, 400);
});

test('edit plan returns concrete steps and marks the row', async () => {
  const res = await post(`/api/media/${guidedId}/edit`, { instructions: 'make it brighter and add bold captions' });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.plan.steps) && data.plan.steps.length >= 5);
  assert.strictEqual(data.plan.engineStatus, 'awaiting_media_api');

  const list = await (await get('/api/media')).json();
  const item = list.items.find((m) => m.id === guidedId);
  assert.strictEqual(item.status, 'edit_plan');
  assert.ok(item.brief.editPlan, 'edit plan merged into the stored brief');
});

test('post-now without a live platform simulates and lands on the calendar', async () => {
  const res = await post('/api/content/post-now', { platform: 'instagram', postText: 'Fresh phone screens just arrived!' });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.simulated, true);
  assert.strictEqual(data.post.status, 'posted');

  const cal = await (await get('/api/content/calendar')).json();
  assert.ok(cal.some((p) => p.post_text === 'Fresh phone screens just arrived!' && p.status === 'posted'));
});

test('post-now requires post text', async () => {
  assert.strictEqual((await post('/api/content/post-now', { platform: 'instagram' })).status, 400);
});

test('logo generation returns exactly 4 safe SVG variants', async () => {
  const res = await post('/api/onboarding/logos', {
    businessName: 'Atlas Repair',
    category: 'Phone Repair',
    tone: 'Professional & Trustworthy',
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.logos.length, 4);
  for (const logo of data.logos) {
    assert.ok(logo.svg.startsWith('<svg'), 'svg starts with <svg');
    assert.doesNotMatch(logo.svg, DANGEROUS_SVG);
    assert.ok(logo.palette && logo.palette.bg && logo.palette.fg && logo.palette.accent);
    assert.ok(typeof logo.style === 'string' && logo.style.length > 0);
  }
  assert.strictEqual(new Set(data.logos.map((l) => l.style)).size, 4, 'four distinct styles');
});

test('briefs, edit plans and logos all draw from the WRITING allowance', async () => {
  const before2 = await (await get('/api/usage')).json();
  // 2 briefs + 1 edit plan + 1 logo batch already consumed allowance above.
  // They are all text generation, so none of them touch the image budget —
  // only an actual render does.
  assert.ok(before2.buckets.writing.used >= 4, `expected at least 4 used, got ${before2.buckets.writing.used}`);
  assert.strictEqual(before2.buckets.image.used, 0, 'writing a brief is not rendering an image');

  const res = await post('/api/onboarding/logos', { businessName: 'Atlas Repair' });
  assert.strictEqual(res.status, 200);
  const after2 = await (await get('/api/usage')).json();
  assert.strictEqual(after2.buckets.writing.used, before2.buckets.writing.used + 1);
  assert.strictEqual(after2.buckets.image.used, 0);
});
