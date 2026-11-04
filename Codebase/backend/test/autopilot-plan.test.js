// Autopilot, the planned way: it posts on a schedule (fixed or "you decide"),
// learns the channel's style and topics from its own posts, asks the owner
// what it can't learn, rotates topics, and features the owner's news.
//
// Keyless (no model): the deterministic parts are what is under test. A stub
// stands in for the model where a test needs one.
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `markivo-applan-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.AUTONOMOUS_ENABLED = 'true';
process.env.GEMINI_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.META_CLIENT_ID = '';
process.env.META_CLIENT_SECRET = '';
process.env.AI_LIMIT_FREEMIUM_WRITING = '40';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const { app, db, runAutonomousTick } = require('../server');
const autonomous = require('../autonomous');
const sched = require('../autopilotSchedule');
const style = require('../autopilotStyle');
const brief = require('../autopilotBrief');
const realConfig = require('../config');

let server, base;
const call = (method) => async (pathname, body, token) => fetch(`${base}${pathname}`, {
  method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});
const post = call('POST');
const put = call('PUT');
const get = call('GET');

async function signUp(name, extra = {}) {
  const reg = await post('/api/auth/register', { email: `${name}${Date.now()}${Math.random()}@m.uz`, password: 'secret123', fullName: name });
  const access = (await reg.json()).accessToken;
  const onb = await post('/api/onboarding/construct', {
    businessName: `${name} Cafe`, category: 'Cafe / Coffee Shop',
    description: 'A cozy specialty coffee shop in Tashkent.', ...extra,
  }, access);
  return { access, profileId: (await onb.json()).profile.id };
}

const EVERY_DAY_10 = { mode: 'fixed', days: [0, 1, 2, 3, 4, 5, 6], times: ['10:00'], timezone: 'Asia/Tashkent' };
const HOUR = 60 * 60 * 1000;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

// --- The schedule ---------------------------------------------------------

test('a fixed schedule turns into slots at the owner\'s local time', () => {
  const plan = sched.normalizeSchedule({ mode: 'fixed', days: [2, 4], times: ['9:30', '19:00'], timezone: 'Asia/Tashkent' });
  assert.deepEqual(plan.times, ['09:30', '19:00']);
  assert.equal(plan.postsPerWeek, 4);
  // Wednesday 4 Nov 2026, 12:00 UTC. Next: Thu 09:30 and 19:00 Tashkent (UTC+5).
  const slots = sched.upcomingSlots(plan, { fromMs: Date.parse('2026-11-04T12:00:00Z'), count: 3 });
  assert.deepEqual(slots.map((s) => s.at), ['2026-11-05T04:30:00.000Z', '2026-11-05T14:00:00.000Z', '2026-11-10T04:30:00.000Z']);
});

test('smart mode spreads N posts a week and picks times by kind of business', () => {
  const plan = sched.normalizeSchedule({ mode: 'smart', postsPerWeek: 3 });
  assert.equal(plan.timezone, 'Asia/Tashkent');
  const best = sched.bestTimes({ category: 'Cafe / Coffee Shop' });
  assert.equal(best.source, 'category');
  const week = sched.upcomingSlots(plan, { fromMs: Date.parse('2026-11-01T00:00:00Z'), count: 3, best });
  assert.deepEqual(week.map((s) => s.weekday), [1, 3, 5], 'Mon, Wed, Fri');
  assert.ok(week.every((s) => s.time === best.times[0]));
  // Ten a week: every day, twice on three of them.
  const ten = sched.upcomingSlots(sched.normalizeSchedule({ postsPerWeek: 10 }), { fromMs: Date.parse('2026-11-01T00:00:00Z'), count: 20, best });
  const firstWeek = ten.filter((s) => s.ms < Date.parse('2026-11-08T00:00:00Z') - 5 * HOUR);
  assert.equal(firstWeek.length, 10);
});

test('with enough history, the best time is when the channel\'s posts do best', () => {
  const posts = [];
  for (let i = 0; i < 9; i += 1) posts.push({ postedAt: new Date(Date.parse('2026-10-01T14:10:00Z') + i * 86400000).toISOString(), viewCount: 1000 });
  posts.push({ postedAt: '2026-10-02T04:00:00Z', viewCount: 200 });
  const best = sched.bestTimes({ posts, category: 'Cafe' });
  assert.equal(best.source, 'history');
  assert.equal(best.times[0], '19:00', '14:10 UTC is 19:10 in Tashkent');
});

test('a slot is written an hour ahead when it auto-publishes, half a day ahead for approval', () => {
  const plan = sched.normalizeSchedule(EVERY_DAY_10);
  const slot = Date.parse('2026-11-05T05:00:00Z');
  const early = sched.slotDecision(plan, { nowMs: slot - 2 * HOUR, autoPublish: true });
  assert.equal(early.due, null);
  assert.equal(early.nextRunAt, new Date(slot - HOUR).toISOString());
  const inWindow = sched.slotDecision(plan, { nowMs: slot - 30 * 60 * 1000, autoPublish: true });
  assert.equal(inWindow.due.at, new Date(slot).toISOString());
  assert.equal(inWindow.nextRunAt, new Date(slot + 24 * HOUR - HOUR).toISOString(), 'next: tomorrow\'s slot, an hour ahead');
  assert.ok(sched.slotDecision(plan, { nowMs: slot - 6 * HOUR, autoPublish: false }).due, 'approval: 12h lead');
  assert.deepEqual(sched.occasionsNear(Date.parse('2026-03-19T10:00:00Z')), [{ name: 'Navruz', inDays: 2 }]);
});

// --- Learning the channel ---------------------------------------------------

test('measured style: length, emojis, hashtags, lists, script, and the best posts as examples', () => {
  const samples = [
    { text: '🔥 Yangi menyu!\n✅ Lavash 25 000\n✅ Burger 30 000\n#noir', views: 1200, postedAt: '2026-10-01T14:00:00Z' },
    { text: 'Bugun 19:00 da jonli musiqa 🎶 Keling!', views: 800, postedAt: '2026-10-03T14:00:00Z' },
    { text: 'Yangi kofe navi keldi, tatib ko‘ring', views: 400, postedAt: '2026-10-05T14:00:00Z' },
  ];
  const m = style.measure(samples);
  assert.equal(m.count, 3);
  assert.equal(m.lengthLevel, 'short');
  assert.equal(m.emojiLevel, 'few');
  assert.equal(m.hashtagShare, 33);
  assert.equal(m.listShare, 33);
  assert.equal(m.script, 'latin');
  assert.equal(m.medianViews, 800);
  assert.deepEqual(style.pickExamples(samples, 2).map((e) => e.views), [1200, 800]);
  const themes = style.scoreThemes([{ name: 'Menu', posts: [0, 2] }, { name: 'Events', posts: [1] }], samples, 800);
  assert.deepEqual(themes.map((t) => [t.name, t.share, t.performance]), [['Menu', 67, 1], ['Events', 33, 1]]);
});

// --- The brief ------------------------------------------------------------

test('a brand-new channel is asked what, how and when; a learned one only what it can\'t learn', () => {
  assert.deepEqual(brief.missingQuestions({ brief: null, style: null, scheduleChosen: false }).required,
    ['themes', 'goal', 'tone', 'length', 'emoji', 'schedule']);
  assert.deepEqual(brief.missingQuestions({ brief: null, style: { sufficient: true, themes: [] }, scheduleChosen: false }).required, ['themes'],
    'enough posts but no model to read topics: only topics are asked');
  assert.deepEqual(brief.missingQuestions({ brief: null, style: { sufficient: true, themes: [{ name: 'Menu' }] } }).required, []);
  // "You decide" counts as an answer.
  assert.deepEqual(brief.missingQuestions({ brief: { themes: 'auto', goal: 'auto', tone: 'auto', length: 'auto', emoji: 'auto', scheduleAsked: 'auto' } }).required, []);
});

test('answers are validated; whatever was asked and left blank becomes "you decide"', () => {
  const { patch } = brief.normalizeAnswers(
    { themes: ['offers', 'Lunch deals', 'offers'], goal: 'visits', tone: 'shouting', news: '  New  oven ' },
    { asked: ['themes', 'goal', 'tone', 'length', 'schedule', 'cta'], nowMs: Date.parse('2026-11-04T00:00:00Z') },
  );
  assert.deepEqual(patch.themes, ['offers', 'Lunch deals']);
  assert.equal(patch.goal, 'visits');
  assert.equal(patch.tone, 'auto', 'an invalid value is not stored; the asked question becomes "you decide"');
  assert.equal(patch.length, 'auto');
  assert.equal(patch.scheduleAsked, 'auto');
  assert.equal(patch.news, 'New oven');
  assert.equal(patch.newsAt, '2026-11-04T00:00:00.000Z');
  assert.deepEqual(patch.seenOptional, ['cta']);
});

test('topics rotate by share, favouring what performs, never twice in a row with three or more', () => {
  const pool = brief.themePool({ brief: { themes: ['offers', 'tips', 'reviews'] } });
  const seq = [];
  for (let i = 0; i < 6; i += 1) seq.unshift(brief.pickTheme(pool, seq).key);
  assert.deepEqual(seq.reverse(), ['offers', 'tips', 'reviews', 'offers', 'tips', 'reviews']);
  const learned = brief.themePool({ style: { themes: [{ key: 'a', name: 'Menu', share: 60, performance: 1.5 }, { key: 'b', name: 'Events', share: 40, performance: 0.5 }] } });
  const picks = [];
  for (let i = 0; i < 10; i += 1) picks.unshift(brief.pickTheme(learned, picks).key);
  assert.ok(picks.filter((k) => k === 'a').length >= 7, 'the theme that does better gets most of the posts');
});

// --- End to end -------------------------------------------------------------

test('a new channel: Autopilot asks first, then posts on the plan, rotating topics', async () => {
  const { access, profileId } = await signUp('Plan');
  await put('/api/autonomous/config', { enabled: true, platforms: ['meta_facebook'], frequency: 'scheduled', autoPublish: true }, access);

  // 1. Nothing to learn from and no brief: it asks, and writes nothing.
  const first = await runAutonomousTick({ now: Date.now() });
  const ran = first.results.find((r) => r.profileId === profileId);
  assert.equal(ran.paused, 'needs-context');
  const { request } = await (await get('/api/autonomous/context-request', undefined, access)).json();
  const ids = request.questions.map((q) => q.id);
  assert.deepEqual(ids, ['themes', 'goal', 'tone', 'length', 'emoji', 'schedule', 'cta', 'avoid', 'news']);
  assert.equal(request.source, 'brief');
  assert.ok(request.questions.find((q) => q.id === 'goal').options.length >= 4);
  assert.equal(db.calendar.listByProfile(profileId).length, 0);

  // 2. The owner answers part of it; the rest is "you decide".
  const ans = await post('/api/autonomous/context-request/answer', {
    requestId: request.id,
    answers: { themes: ['offers', 'tips'], goal: 'visits', schedule: EVERY_DAY_10, cta: 'Call +998 90 123 45 67' },
  }, access);
  assert.equal(ans.status, 200);
  const saved = (await ans.json()).brief;
  assert.equal(saved.tone, 'auto');
  assert.equal(saved.cta, 'Call +998 90 123 45 67');
  assert.deepEqual(db.autonomous.getConfig(profileId).schedule.times, ['10:00']);

  // 3. The plan shows the next five slots with their topics.
  const status = await (await get('/api/autonomous/status', undefined, access)).json();
  assert.equal(status.plan.upcoming.length, 5);
  assert.ok(status.plan.upcoming.every((u) => u.time === '10:00'));
  assert.deepEqual(status.plan.upcoming.slice(0, 2).map((u) => u.theme.key), ['offers', 'tips']);
  assert.ok(Array.isArray(status.questions) && status.questions.length === brief.QUESTIONS.length);

  // 4. Between slots: ready, nothing written.
  const plan = sched.normalizeSchedule(db.autonomous.getConfig(profileId).schedule);
  const [s1, s2] = sched.upcomingSlots(plan, { fromMs: Date.now() + 2 * HOUR, count: 2 });
  db.autonomous.setRun(profileId, { nextRunAt: new Date().toISOString() });
  const idle = (await runAutonomousTick({ now: s1.ms - 3 * HOUR })).results.find((r) => r.profileId === profileId);
  assert.equal(idle.waiting, 'next-slot');
  assert.equal(db.calendar.listByProfile(profileId).length, 0);

  // 5. In the slot's window: one post, on the Calendar AT the slot.
  const r1 = (await runAutonomousTick({ now: s1.ms - 30 * 60 * 1000 })).results.find((r) => r.profileId === profileId);
  assert.equal(r1.scheduled, 1);
  assert.equal(r1.slotAt, s1.at);
  assert.equal(r1.theme, 'offers');
  const row = db.calendar.listByProfile(profileId)[0];
  assert.equal(row.scheduled_time, s1.at);
  assert.equal(row.status, 'scheduled');
  assert.equal(row.source, 'autopilot');
  assert.match(row.post_text, /\+998 90 123 45 67/, 'the owner\'s contact goes in, exactly as written');

  // Same instant again: already claimed.
  const again = (await runAutonomousTick({ now: s1.ms - 30 * 60 * 1000 })).results.find((r) => r.profileId === profileId);
  assert.ok(!again, 'not due again until the next slot');

  // 6. The next slot gets the next topic.
  const r2 = (await runAutonomousTick({ now: s2.ms - 30 * 60 * 1000 })).results.find((r) => r.profileId === profileId);
  assert.equal(r2.theme, 'tips');

  // 7. News jumps the queue once, then the rotation resumes.
  const news = await put('/api/autonomous/brief', { answers: { news: 'New pistachio latte from Monday' } }, access);
  assert.equal(news.status, 200);
  const [s3, s4] = sched.upcomingSlots(plan, { fromMs: s2.ms + HOUR, count: 2 });
  const r3 = (await runAutonomousTick({ now: s3.ms - 30 * 60 * 1000 })).results.find((r) => r.profileId === profileId);
  assert.equal(r3.theme, 'news');
  assert.ok(db.calendar.listByProfile(profileId).some((p) => /pistachio latte/.test(p.post_text)));
  const r4 = (await runAutonomousTick({ now: s4.ms - 30 * 60 * 1000 })).results.find((r) => r.profileId === profileId);
  assert.equal(r4.theme, 'offers');

  // 8. Approval mode: the post waits for an OK, and an OK before the slot
  //    schedules it for the slot instead of posting now.
  await put('/api/autonomous/config', { enabled: true, platforms: ['meta_facebook'], frequency: 'scheduled', autoPublish: false }, access);
  const [s5] = sched.upcomingSlots(plan, { fromMs: Date.now() + 8 * HOUR, count: 1 });
  const r5 = (await runAutonomousTick({ now: s5.ms - 6 * HOUR })).results.find((r) => r.profileId === profileId);
  assert.equal(r5.queued, 1);
  const approval = db.approvals.listByProfile(profileId, 10).find((a) => a.status === 'pending');
  assert.equal(approval.action_payload.scheduledFor, s5.at);
  const before = db.calendar.listByProfile(profileId).length;
  const ok = await post('/api/agent/approve', { approvalId: approval.id }, access);
  assert.equal(ok.status, 200);
  const okBody = await ok.json();
  assert.equal(okBody.scheduled, true);
  const added = db.calendar.listByProfile(profileId);
  assert.equal(added.length, before + 1);
  assert.ok(added.some((p) => p.scheduled_time === s5.at && p.status === 'scheduled' && p.source === 'autopilot'));

  // 9. Run now still posts right away, and leaves the plan alone.
  await put('/api/autonomous/config', { enabled: true, platforms: ['meta_facebook'], frequency: 'scheduled', autoPublish: true }, access);
  const planned = db.autonomous.getConfig(profileId).nextRunAt;
  const now = await post('/api/autonomous/run', {}, access);
  const nowBody = await now.json();
  assert.equal(nowBody.result.published, 1);
  assert.equal(db.autonomous.getConfig(profileId).nextRunAt, planned);
});

test('a channel with enough posts: Autopilot learns its habits and best time, and only asks about topics', async () => {
  const { access, profileId } = await signUp('Learned');
  const posts = [];
  for (let i = 0; i < 9; i += 1) {
    posts.push({
      externalId: String(100 + i),
      caption: `Bugungi taklif ${i}: yangi desert va kofe. Keling! ☕️`,
      postedAt: new Date(Date.parse('2026-10-01T14:05:00Z') + i * 2 * 86400000).toISOString(),
      viewCount: 500 + i * 10,
    });
  }
  db.ownContent.mergePosts(profileId, 'telegram', posts, { source: 'bot' });
  await put('/api/autonomous/config', { enabled: true, platforms: ['meta_facebook'], frequency: 'scheduled', autoPublish: true }, access);
  const run = (await runAutonomousTick({ now: Date.now() })).results.find((r) => r.profileId === profileId);
  assert.equal(run.paused, 'needs-context');
  const pending = db.autonomous.pendingContextRequest(profileId);
  assert.deepEqual(pending.questions.map((q) => q.id), ['themes', 'cta', 'avoid', 'news']);

  const status = await (await get('/api/autonomous/status', undefined, access)).json();
  assert.equal(status.style.sufficient, true);
  assert.equal(status.style.sampleCount, 9);
  assert.equal(status.style.timing.source, 'history');
  assert.equal(status.style.timing.times[0], '19:00');
  assert.equal(status.style.stats.emojiLevel, 'few');
  // Smart mode follows the learned time.
  assert.ok(status.plan.upcoming.every((u) => u.time === '19:00'));
});

test('with a model, the learned voice and topics drive the post without any questions', async () => {
  const { profileId } = await signUp('Voice');
  const posts = [];
  for (let i = 0; i < 6; i += 1) {
    posts.push({ externalId: `v${i}`, caption: `Post number ${i} about our menu and events this week`, postedAt: new Date(Date.parse('2026-10-01T07:00:00Z') + i * 86400000).toISOString(), viewCount: 100 * (i + 1) });
  }
  db.ownContent.mergePosts(profileId, 'telegram', posts);
  db.autonomous.upsertConfig({ profileId, enabled: true, platforms: ['meta_facebook'], frequency: 'scheduled', autoPublish: true, nextRunAt: new Date().toISOString(), schedule: EVERY_DAY_10 });

  const stubGemini = {
    learnChannelStyle: async () => ({
      voice: 'Warm, talks to regulars by name.', formatting: 'Two short lines and an emoji.',
      // Numbers are 1-based over the posts as shown, newest first: Menu has
      // the three newest (most-viewed) posts.
      themes: [{ name: 'Events', description: 'Live music', posts: [4, 5, 6] }, { name: 'Menu', description: 'New dishes', posts: [1, 2, 3] }],
      habits: ['Ends with “Kutamiz!”'], avoid: ['Hashtags'],
    }),
    assessAdContext: async () => { throw new Error('must not be asked: the channel says enough'); },
  };
  let seen = null;
  const stubAi = { analyzeAndPlan: async (ctx) => { seen = ctx; return { analysis: 'ok', posts: [{ platform: 'meta_facebook', text: 'Hello regulars' }] }; } };
  const connectors = require('../connectors/registry');
  const result = await autonomous.runProfileAutopilot({
    db, ai: stubAi, connectors, config: realConfig, publishers: {}, gemini: stubGemini, profileId, nowMs: Date.now(), force: true,
  });
  assert.ok(!result.paused, 'no questions for a channel that already shows what and how');
  assert.match(seen.styleGuide, /Voice: Warm, talks to regulars by name\./);
  assert.match(seen.styleGuide, /REAL POSTS FROM THIS CHANNEL/);
  assert.equal(seen.theme.name, 'Menu', 'same share, but Menu gets more views');
  assert.ok(seen.moment && seen.moment.length > 0);
  const stored = db.autonomous.getStyle(profileId);
  assert.equal(stored.source, 'gemini');
  assert.ok(stored.themes.find((t) => t.name === 'Menu').performance > 1);
});

test('route contract: bad schedule input and brief input are refused', async () => {
  const { access } = await signUp('Routes');
  const badTz = await put('/api/autonomous/config', { enabled: true, schedule: { mode: 'smart', timezone: 'Mars/Olympus' } }, access);
  assert.equal(badTz.status, 400);
  const good = await put('/api/autonomous/config', { enabled: true, frequency: 'scheduled', schedule: { mode: 'smart', postsPerWeek: 99, timezone: 'Europe/Moscow' } }, access);
  assert.equal(good.status, 200);
  const body = await good.json();
  assert.equal(body.config.schedule.postsPerWeek, 14);
  assert.equal(body.plan.schedule.timezone, 'Europe/Moscow');
  assert.equal((await put('/api/autonomous/brief', { answers: 'nope' }, access)).status, 400);
  assert.equal((await put('/api/autonomous/brief', {}, undefined)).status, 401);
});
