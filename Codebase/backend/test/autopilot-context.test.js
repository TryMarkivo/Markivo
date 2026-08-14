// Autopilot's context gate — the "ask the owner instead of guessing" interrupt.
//
// Keys pinned to '' BEFORE requiring the app (config caches env at load), so
// the gate's KEYLESS path is what runs unless a test injects its own gemini
// stub. Defining them as '' rather than deleting means dotenv cannot backfill
// them from a .env on disk.
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `markivo-apctx-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.AUTONOMOUS_ENABLED = 'true';
process.env.GEMINI_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const { app, db, runAutonomousTick } = require('../server');
const autopilotContext = require('../autopilotContext');

let server, base, access, profileId;

const req = (method) => async (pathname, body, token) => fetch(`${base}${pathname}`, {
  method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});
const post = req('POST');
const put = req('PUT');
const get = req('GET');

// A model that always says "I don't know enough" — drives the pause path
// deterministically, with no key and no network.
const stubInsufficient = {
  assessAdContext: async () => ({
    sufficient: false,
    adType: '',
    rationale: 'Not enough channel context to choose an ad type.',
    questions: ['What kind of post do you want?', 'What is the goal?'],
    source: 'gemini',
  }),
};

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const reg = await post('/api/auth/register', { email: `apctx${Date.now()}@m.uz`, password: 'secret123', fullName: 'Ctx Owner' });
  access = (await reg.json()).accessToken;
  const onb = await post('/api/onboarding/construct', {
    businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop',
    description: 'A cozy specialty coffee shop in Tashkent for remote workers.',
    tone: 'Cozy & Warm',
  }, access);
  profileId = (await onb.json()).profile.id;
});

after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

// --- The keyless contract -------------------------------------------------

test('keyless: a profile with any real signal is judged sufficient', () => {
  const signals = autopilotContext.gatherChannelSignals({ db, profileId, platforms: ['tiktok'] });
  // Onboarding gives this profile a description AND seeds a welcome post, so
  // there is genuinely something to work from.
  assert.ok(signals.recentPosts.length > 0 || signals.profile.description);
  const assessment = autopilotContext.heuristicAssessment(signals);
  assert.equal(assessment.sufficient, true);
  assert.equal(assessment.source, 'heuristic');
  assert.deepEqual(assessment.questions, []);
});

test('keyless: a profile with nothing at all asks the owner up to three questions', () => {
  const assessment = autopilotContext.heuristicAssessment({
    profile: { description: '' },
    businessContext: null,
    userContext: null,
    connectedPlatforms: [],
    telegram: { linked: false },
    instagram: { linked: false },
    recentPosts: [],
    competitors: [],
  });
  assert.equal(assessment.sufficient, false);
  assert.equal(assessment.questions.length, 3);
  assert.ok(assessment.rationale.length > 0, 'the owner is told why it stopped');
});

// --- The interrupt --------------------------------------------------------

test('Autopilot halts with paused:needs-context and generates nothing', async () => {
  await put('/api/autonomous/config', { enabled: true, platforms: ['tiktok'], frequency: 'test', autoPublish: true }, access);

  const postedBefore = db.calendar.listByProfile(profileId).filter((p) => p.status === 'posted').length;
  const approvalsBefore = db.approvals.listByProfile(profileId, 100).length;

  const result = await runAutonomousTick({ now: Date.now() + 10 * 60 * 1000, gemini: stubInsufficient });
  const ran = (result.results || []).find((x) => x.profileId === profileId);

  assert.equal(ran.paused, 'needs-context');
  assert.equal(
    db.calendar.listByProfile(profileId).filter((p) => p.status === 'posted').length,
    postedBefore,
    'a paused run must not publish anything',
  );
  assert.equal(
    db.approvals.listByProfile(profileId, 100).length,
    approvalsBefore,
    'a paused run must not queue anything either',
  );

  const activity = db.autonomous.listActivity(profileId, 20);
  assert.ok(activity.some((a) => a.kind === 'context_needed'));
  assert.ok(!activity.slice(0, 1).some((a) => a.kind === 'analysis'), 'it halted before the generation step');
});

test('an unanswered request is not re-asked on the next tick', async () => {
  const pending = db.autonomous.pendingContextRequest(profileId);
  assert.ok(pending, 'the previous test left one open question');

  const asksBefore = db.autonomous.listActivity(profileId, 100).filter((a) => a.kind === 'context_needed').length;
  await put('/api/autonomous/config', { enabled: true, platforms: ['tiktok'], frequency: 'test', autoPublish: true }, access);
  await runAutonomousTick({ now: Date.now() + 30 * 60 * 1000, gemini: stubInsufficient });

  const rows = db.autonomous.listContextRequests(profileId, 50).filter((r) => r.status === 'pending');
  assert.equal(rows.length, 1, 'still exactly one open question — no duplicate rows');
  assert.equal(
    db.autonomous.listActivity(profileId, 100).filter((a) => a.kind === 'context_needed').length,
    asksBefore,
    'and it was not logged a second time',
  );
});

// --- The answer path ------------------------------------------------------

test('GET context-request surfaces the open question', async () => {
  const res = await get('/api/autonomous/context-request', undefined, access);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.request, 'there is an open request');
  assert.ok(body.request.questions.length > 0);
  assert.equal(body.request.status, 'pending');
});

test('answering unblocks the next run and is remembered', async () => {
  const answerRes = await post('/api/autonomous/context-request/answer', {
    answer: 'Drive weekday-morning walk-ins before 11am.',
  }, access);
  assert.equal(answerRes.status, 200);
  assert.equal((await answerRes.json()).request.status, 'answered');

  // The question is cleared, and the answer is retained for future runs.
  const after = await (await get('/api/autonomous/context-request', undefined, access)).json();
  assert.equal(after.request, null);
  assert.match(after.lastAnswer.answer, /weekday-morning walk-ins/);

  // Same always-insufficient model — but the owner answered, so it proceeds.
  const postedBefore = db.calendar.listByProfile(profileId).filter((p) => p.status === 'posted').length;
  const result = await runAutonomousTick({ now: Date.now() + 60 * 60 * 1000, gemini: stubInsufficient });
  const ran = (result.results || []).find((x) => x.profileId === profileId);

  assert.ok(!ran.paused, 'an answered owner must not be asked again in a loop');
  assert.ok(
    db.calendar.listByProfile(profileId).filter((p) => p.status === 'posted').length > postedBefore,
    'generation proceeded once context existed',
  );
  assert.ok(db.autonomous.listActivity(profileId, 50).some((a) => a.kind === 'context_answered'));
});

// --- Route contract -------------------------------------------------------

test('the context-request routes reject bad input', async () => {
  const noAuth = await get('/api/autonomous/context-request');
  assert.equal(noAuth.status, 401);

  const empty = await post('/api/autonomous/context-request/answer', { answer: '   ' }, access);
  assert.equal(empty.status, 400);

  const tooLong = await post('/api/autonomous/context-request/answer', { answer: 'x'.repeat(2001) }, access);
  assert.equal(tooLong.status, 400);

  // Nothing is open now — the previous test answered it.
  const none = await post('/api/autonomous/context-request/answer', { answer: 'anything' }, access);
  assert.equal(none.status, 404);
});
