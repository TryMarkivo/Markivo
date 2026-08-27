const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate DB + secret BEFORE requiring the app (config reads env at load).
// No ANTHROPIC_API_KEY or GEMINI_API_KEY -> the AI layer falls back to
// deterministic templates, so Autopilot runs fully keyless (analysis +
// sandbox publishing) rather than depending on (or rate-limiting against) a
// live model.
const TMP_DB = path.join(os.tmpdir(), `markivo-autopilot-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.AUTONOMOUS_ENABLED = 'true';

// DISABLED: SEO/Meta temporarily off — see 2026-08-13
// These cases used 'meta_instagram' as the test platform. With the Meta
// adapters out of the connector registry, they run against 'google_business'
// instead — same sandbox publish path (connectors/googleBusiness.js ->
// simulatedPublish), no network. Swap back to 'meta_instagram' when Meta is
// re-enabled. (TikTok, the platform this suite used before it, was removed
// entirely — see 2026-08-15.)
const { app, db, runAutonomousTick } = require('../server');
const autonomous = require('../autonomous');
const realConfig = require('../config');

let server, base, access, profileId, userId;

const req = (method) => async (pathname, body, token) => {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res;
};
const post = req('POST');
const put = req('PUT');
const get = req('GET');

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const reg = await post('/api/auth/register', { email: `auto${Date.now()}@m.uz`, password: 'secret123', fullName: 'Auto Owner' });
  access = (await reg.json()).accessToken;
  const onb = await post('/api/onboarding/construct', {
    businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop',
    description: 'A cozy specialty coffee shop in Tashkent for remote workers.',
    tone: 'Cozy & Warm',
  }, access);
  profileId = (await onb.json()).profile.id;
  userId = db.profiles.findById(profileId).userId;
});

after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

test('config: enabling Autopilot stores platforms and makes it due', async () => {
  const res = await put('/api/autonomous/config', {
    enabled: true, platforms: ['google_business'], frequency: 'test', autoPublish: true,
  }, access);
  assert.equal(res.status, 200);
  const { config } = await res.json();
  assert.equal(config.enabled, true);
  assert.deepEqual(config.platforms, ['google_business']);
  assert.equal(config.autoPublish, true);
  // Bad platform keys are dropped by the validator.
  const res2 = await put('/api/autonomous/config', { enabled: true, platforms: ['google_business', 'not_a_platform'], frequency: 'test' }, access);
  assert.deepEqual((await res2.json()).config.platforms, ['google_business']);
});

test('tick auto-publishes an organic post (sandbox) and never creates an ad', async () => {
  const result = await runAutonomousTick({ now: Date.now() });
  assert.ok(result.due >= 1, 'the enabled profile should be due');

  const posted = db.calendar.listByProfile(profileId).filter((p) => p.status === 'posted');
  assert.ok(posted.length >= 1, 'an organic post was published (sandbox-simulated)');
  assert.ok(posted.some((p) => p.platform === 'google_business'));

  // INVARIANT: Autopilot must never create or run a paid ad campaign.
  const approvals = db.approvals.listByProfile(profileId);
  assert.ok(!approvals.some((a) => a.action_type === 'ad_creation'), 'no ad_creation approvals');

  const activity = db.autonomous.listActivity(profileId, 50);
  assert.ok(activity.some((a) => a.kind === 'analysis'));
  assert.ok(activity.some((a) => a.kind === 'post_published'));
});

test('manual "Run now" publishes immediately and returns activity', async () => {
  const res = await post('/api/autonomous/run', {}, access);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.result.published >= 1 || body.result.scheduled >= 1);
  assert.ok(Array.isArray(body.activity));
});

test('queue mode creates PENDING organic approvals, never auto-approved', async () => {
  // Re-save config (enabling resets next_run_at to now, so it is due again).
  await put('/api/autonomous/config', {
    enabled: true, platforms: ['google_business', 'telegram'], frequency: 'test', autoPublish: false,
  }, access);

  const before = db.approvals.listByProfile(profileId, 100).length;
  // Advance well past the 'test' cadence so the profile is due again (saving
  // settings no longer re-arms the timer).
  await runAutonomousTick({ now: Date.now() + 5 * 60 * 1000 });
  const approvals = db.approvals.listByProfile(profileId, 100);

  assert.ok(approvals.length > before, 'new approvals were queued');
  const fresh = approvals.slice(0, approvals.length - before);
  assert.ok(fresh.every((a) => a.status === 'pending'), 'queued approvals stay pending until a human approves');
  assert.ok(fresh.every((a) => a.action_type === 'telegram_post' || a.action_type === 'platform_post'));
  assert.ok(fresh.every((a) => a.action_payload && a.action_payload.autonomous === true));
  assert.ok(fresh.every((a) => a.action_payload.cost === 'Free — organic post'));
});

test('GET /api/autonomous/approvals lists the pending queue; approve and reject both clear it', async () => {
  const listRes = await get('/api/autonomous/approvals', undefined, access);
  assert.equal(listRes.status, 200);
  const { approvals } = await listRes.json();
  assert.ok(approvals.length >= 2, 'the queue-mode test above left pending approvals');
  assert.ok(approvals.every((a) => a.status === 'pending'), 'only pending rows are listed');
  assert.ok(approvals.every((a) => typeof a.action_payload?.text === 'string'), 'full post text is included, not truncated');

  const noAuth = await get('/api/autonomous/approvals');
  assert.equal(noAuth.status, 401);

  // Approve specifically the 'google_business' one (always sandbox-safe here,
  // since GOOGLE_CLIENT_ID is unset in this test env) rather than an arbitrary
  // array element — a 'telegram_post' approval could hit a real, differently-
  // configured Telegram integration in other environments and 400 on publish,
  // which isn't what this test is about. Rejecting never publishes anything,
  // so any other pending row is safe to use there.
  const toApprove = approvals.find((a) => a.action_payload?.platform === 'google_business') || approvals[0];
  const toReject = approvals.find((a) => a.id !== toApprove.id);

  const rejectRes = await post('/api/agent/reject', { approvalId: toReject.id }, access);
  assert.equal(rejectRes.status, 200);
  assert.equal(db.approvals.findById(toReject.id).status, 'rejected');
  // Rejecting again 400s — it is no longer pending.
  assert.equal((await post('/api/agent/reject', { approvalId: toReject.id }, access)).status, 400);

  const approveRes = await post('/api/agent/approve', { approvalId: toApprove.id }, access);
  assert.equal(approveRes.status, 200);
  assert.equal(db.approvals.findById(toApprove.id).status, 'approved');

  const afterRes = await get('/api/autonomous/approvals', undefined, access);
  const after = (await afterRes.json()).approvals;
  assert.ok(!after.some((a) => a.id === toReject.id || a.id === toApprove.id), 'both are gone from the pending queue');
});

test('a second overlapping tick does not double-run the same profile', async () => {
  await put('/api/autonomous/config', { enabled: true, platforms: ['google_business'], frequency: 'test', autoPublish: true }, access);
  const now = Date.now() + 20 * 60 * 1000; // safely past the cadence -> due
  const postedBefore = db.calendar.listByProfile(profileId).filter((p) => p.status === 'posted').length;

  const r1 = await runAutonomousTick({ now });
  const r2 = await runAutonomousTick({ now }); // same instant — profile already claimed by r1

  assert.ok(r1.due >= 1);
  const ran2 = (r2.results || []).find((x) => x.profileId === profileId);
  assert.ok(!ran2 || ran2.skipped === 'not-due', 'second tick must not re-run the just-claimed profile');

  const postedAfter = db.calendar.listByProfile(profileId).filter((p) => p.status === 'posted').length;
  assert.equal(postedAfter - postedBefore, 1, 'exactly one post published across both ticks');
});

test('Autopilot pauses when the monthly AI allowance is exhausted', async () => {
  // Disable then enable to deterministically re-arm next_run_at = now (due now).
  await put('/api/autonomous/config', { enabled: false }, access);
  await put('/api/autonomous/config', { enabled: true, platforms: ['google_business'], frequency: 'test', autoPublish: true }, access);

  // Exhaust the freemium allowance for this owner.
  const limit = require('../config').aiTierLimits.freemium;
  while (db.usage.countThisMonth(userId) < limit) db.usage.record({ userId, kind: 'filler' });

  const postedBefore = db.calendar.listByProfile(profileId).filter((p) => p.status === 'posted').length;
  await runAutonomousTick({ now: Date.now() });
  const postedAfter = db.calendar.listByProfile(profileId).filter((p) => p.status === 'posted').length;

  assert.equal(postedAfter, postedBefore, 'no new posts when over budget');
  assert.ok(db.autonomous.listActivity(profileId, 5).some((a) => a.kind === 'skipped'));
});

// ---------------------------------------------------------------------------
// Own/competitor content wiring — runProfileAutopilot called directly (not
// through the HTTP tick) with fully stubbed ai/connectors/ownContentFetch, so
// no network call happens and the plan's prompt context can be inspected.
// ---------------------------------------------------------------------------

test('runProfileAutopilot reads own-connected-account content, persists it, and feeds it to the AI plan', async () => {
  const reg = await post('/api/auth/register', { email: `ownfetch${Date.now()}@m.uz`, password: 'secret123', fullName: 'Own Fetch' });
  const token = (await reg.json()).accessToken;
  const onb = await post('/api/onboarding/construct', { businessName: 'Fetch Cafe', category: 'Cafe' }, token);
  const pid = (await onb.json()).profile.id;

  await put('/api/autonomous/config', { enabled: true, platforms: ['meta_instagram'], frequency: 'test', autoPublish: false }, token);
  db.connections.upsert({
    profileId: pid, platform: 'meta_instagram', status: 'connected',
    accountHandle: '@fetchcafe', accountId: 'ig123', accessToken: 'tok', scopes: 'x', meta: { igUserId: 'ig123' },
  });

  const fetchCalls = [];
  const stubOwnContentFetch = {
    fetchOwnContent: async (platform, conn, tgConn) => {
      fetchCalls.push(platform);
      return {
        found: true, partial: false, error: null,
        posts: [{ externalId: 'm1', kind: 'photo', caption: 'Real organic latte art post', postedAt: new Date().toISOString(), likeCount: 5, commentCount: 1, viewCount: null }],
      };
    },
  };
  let lastCtx = null;
  const stubAi = {
    analyzeAndPlan: async (ctx) => {
      lastCtx = ctx;
      return { analysis: 'stub analysis', posts: [{ platform: 'meta_instagram', text: 'Stub post text' }] };
    },
  };
  const stubConnectors = { get: (key) => (key === 'meta_instagram' ? { key: 'meta_instagram', label: 'Instagram' } : null) };

  const result1 = await autonomous.runProfileAutopilot({
    db, ai: stubAi, connectors: stubConnectors, config: realConfig, publishers: {},
    ownContentFetch: stubOwnContentFetch, profileId: pid, nowMs: Date.now(), force: true,
  });
  assert.equal(result1.queued, 1);
  assert.deepEqual(fetchCalls, ['meta_instagram']);
  assert.ok(lastCtx.ownExternalActivity.some((s) => s.includes('meta_instagram') && s.includes('Real organic latte art post')));

  const storedPosts = db.ownContent.listByProfile(pid);
  assert.ok(storedPosts.some((p) => p.caption === 'Real organic latte art post'));
  const groundingEntry = db.autonomous.listActivity(pid, 10).find((a) => a.kind === 'external_content');
  assert.ok(groundingEntry);
  // The real snippets that fed the prompt must be retrievable, not just a count
  // baked into the summary sentence — the Autopilot UI reads this payload to
  // show what actually grounded the plan.
  assert.ok(groundingEntry.payload.ownExternalActivity.some((s) => s.includes('Real organic latte art post')));

  // Second run at the same instant: the cooldown must skip re-fetching.
  await autonomous.runProfileAutopilot({
    db, ai: stubAi, connectors: stubConnectors, config: realConfig, publishers: {},
    ownContentFetch: stubOwnContentFetch, profileId: pid, nowMs: Date.now(), force: true,
  });
  assert.deepEqual(fetchCalls, ['meta_instagram'], 'cooldown must prevent a second fetch this soon');
});
