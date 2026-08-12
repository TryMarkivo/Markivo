const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate DB BEFORE requiring the app (config reads env at load). No
// ANTHROPIC_API_KEY / YOUTUBE_DATA_API_KEY -> this suite asserts fully
// keyless (template + page-scrape) behavior, matching the rest of the suite's
// convention (places.test.js, ai.test.js).
const TMP_DB = path.join(os.tmpdir(), `markivo-competitors-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.SCAN_RATE_LIMIT = '100';
// Fail fast if a mocked-network test's fetch somehow reaches a real host, and
// keep the endpoint-level "graceful degradation" tests fast even if the
// sandbox has no outbound network access at all.
process.env.COMPETITOR_FETCH_TIMEOUT_MS = '500';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.YOUTUBE_DATA_API_KEY;

const competitorFetch = require('../competitorFetch');
const competitorAnalytics = require('../competitorAnalytics');
const metaConnector = require('../connectors/meta');
const ai = require('../ai');
const { validateAddCompetitor, validateCompetitorSource } = require('../validators');
const { app } = require('../server');

// ---------------------------------------------------------------------------
// Unit: validators
// ---------------------------------------------------------------------------

test('validateAddCompetitor accepts valid platform links, rejects bad ones', () => {
  assert.strictEqual(validateAddCompetitor({ sources: [{ platform: 'instagram', url: 'https://instagram.com/somebrand' }] }), null);
  assert.strictEqual(validateAddCompetitor({ name: 'Rival', sources: [{ platform: 'tiktok', url: 'tiktok.com/@somebrand' }] }), null);
  assert.ok(validateAddCompetitor({ sources: [] })); // at least one link required
  assert.ok(validateAddCompetitor({ sources: [{ platform: 'twitter', url: 'https://twitter.com/x' }] })); // unsupported platform
  assert.ok(validateAddCompetitor({ sources: [{ platform: 'instagram', url: 'not a url' }] }));
  assert.ok(validateAddCompetitor({ name: 'x'.repeat(121), sources: [{ platform: 'youtube', url: 'https://youtube.com/@x' }] }));
});

test('validateCompetitorSource mirrors the same URL rules for a single link', () => {
  assert.strictEqual(validateCompetitorSource({ platform: 'facebook', url: 'https://www.facebook.com/somepage' }), null);
  assert.ok(validateCompetitorSource({ platform: 'facebook', url: 'not-a-url' }));
  assert.ok(validateCompetitorSource({ platform: 'unknown', url: 'https://facebook.com/x' }));
});

// ---------------------------------------------------------------------------
// Unit: competitorFetch — mocked network only, never touches real platforms
// ---------------------------------------------------------------------------

const htmlRes = (text, ok = true, status = 200) => async () => ({ ok, status, text: async () => text });

test('fetchInstagram parses follower count + display name from og meta tags', async () => {
  const html = '<meta property="og:title" content="Sunrise Cafe (@sunrisecafe_test)">' +
    '<meta property="og:description" content="12.3K Followers, 421 Following, 89 Posts - See Instagram photos and videos from Sunrise Cafe (@sunrisecafe_test)">';
  const result = await competitorFetch.fetchCompetitorSource('instagram', 'https://instagram.com/sunrisecafe_test', { fetchImpl: htmlRes(html) });
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.handle, 'sunrisecafe_test');
  assert.strictEqual(result.displayName, 'Sunrise Cafe');
  assert.strictEqual(result.followerCount, 12300);
  assert.strictEqual(result.partial, true);
  assert.deepStrictEqual(result.posts, []);
});

test('fetchInstagram degrades honestly on a non-OK response', async () => {
  const result = await competitorFetch.fetchCompetitorSource('instagram', 'https://instagram.com/ghost', { fetchImpl: htmlRes('', false, 404) });
  assert.strictEqual(result.found, false);
  assert.ok(result.error);
});

test('fetchInstagram never throws on a network failure', async () => {
  const throwing = async () => { throw new Error('ECONNRESET'); };
  const result = await competitorFetch.fetchCompetitorSource('instagram', 'https://instagram.com/ghost', { fetchImpl: throwing });
  assert.strictEqual(result.found, false);
  assert.ok(result.error);
});

test('connectors/meta businessDiscovery parses the Graph API response and throws a ConnectorError on failure', async () => {
  const ok = await metaConnector.businessDiscovery('caller_ig_id', 'rivalcafe', 'token_abc', {
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      assert.strictEqual(parsed.origin, 'https://graph.facebook.com');
      assert.ok(parsed.searchParams.get('fields').includes('business_discovery.username(rivalcafe)'));
      assert.strictEqual(parsed.searchParams.get('access_token'), 'token_abc');
      return { ok: true, status: 200, json: async () => ({ business_discovery: { username: 'rivalcafe', followers_count: 500, media: { data: [] } } }) };
    },
  });
  assert.strictEqual(ok.username, 'rivalcafe');
  assert.strictEqual(ok.followers_count, 500);

  await assert.rejects(
    () => metaConnector.businessDiscovery('caller_ig_id', 'rivalcafe', 'token_abc', {
      fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'target account has no permission' } }) }),
    }),
    /target account has no permission/
  );
});

test('fetchInstagram uses real Business Discovery content when the caller has their own Instagram connected via Meta', async () => {
  const bdPayload = {
    business_discovery: {
      username: 'rivalcafe',
      name: 'Rival Cafe',
      followers_count: 8200,
      media_count: 150,
      media: {
        data: [
          { id: 'm1', caption: 'New seasonal menu!', media_type: 'VIDEO', media_url: 'https://x/v1.mp4', thumbnail_url: 'https://x/t1.jpg', timestamp: '2026-08-01T10:00:00+0000', like_count: 320, comments_count: 12 },
          { id: 'm2', caption: 'Morning brew', media_type: 'IMAGE', media_url: 'https://x/i2.jpg', timestamp: '2026-07-28T09:00:00+0000', like_count: 150, comments_count: 4 },
        ],
      },
    },
  };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => bdPayload });
  const result = await competitorFetch.fetchCompetitorSource('instagram', 'https://instagram.com/rivalcafe', {
    fetchImpl, metaIgUserId: 'caller_ig_123', metaAccessToken: 'token_abc',
  });
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.partial, false); // real content, not bio-only
  assert.strictEqual(result.followerCount, 8200);
  assert.strictEqual(result.posts.length, 2);
  assert.strictEqual(result.posts[0].kind, 'video');
  assert.strictEqual(result.posts[0].likeCount, 320);
  assert.strictEqual(result.posts[1].kind, 'photo');
  assert.strictEqual(result.posts[1].caption, 'Morning brew');
});

test('fetchInstagram falls back to the page scrape when Business Discovery fails (e.g. target is a personal account)', async () => {
  const fetchImpl = async (url) => {
    if (String(url).startsWith('https://graph.facebook.com/')) {
      return { ok: false, status: 400, json: async () => ({ error: { message: 'target is not a business account' } }) };
    }
    return {
      ok: true, status: 200,
      text: async () => '<meta property="og:title" content="Rival Cafe (@rivalcafe)"><meta property="og:description" content="1.2K Followers, 300 Following, 40 Posts">',
    };
  };
  const result = await competitorFetch.fetchCompetitorSource('instagram', 'https://instagram.com/rivalcafe', {
    fetchImpl, metaIgUserId: 'caller_ig_123', metaAccessToken: 'token_abc',
  });
  assert.strictEqual(result.partial, true); // fell back to the scrape, honestly bio-only
  assert.strictEqual(result.followerCount, 1200);
  assert.deepStrictEqual(result.posts, []);
});

test('fetchTikTok parses recent videos from an embedded SIGI_STATE blob', async () => {
  const state = {
    UserModule: {
      users: { somebrand: { nickname: 'Some Brand' } },
      stats: { somebrand: { followerCount: 5400 } },
    },
    ItemModule: {
      v1: { id: 'v1', desc: 'Behind the scenes', createTime: '1700000000', video: { cover: 'https://x/cover1.jpg' }, stats: { diggCount: 100, commentCount: 5, playCount: 2000 } },
      v2: { id: 'v2', desc: 'New menu drop', createTime: '1700100000', video: { cover: 'https://x/cover2.jpg' }, stats: { diggCount: 200, commentCount: 8, playCount: 4000 } },
    },
  };
  const html = `<script id="SIGI_STATE" type="application/json">${JSON.stringify(state)}</script>`;
  const result = await competitorFetch.fetchCompetitorSource('tiktok', 'https://tiktok.com/@somebrand', { fetchImpl: htmlRes(html) });
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.displayName, 'Some Brand');
  assert.strictEqual(result.followerCount, 5400);
  assert.strictEqual(result.posts.length, 2);
  assert.strictEqual(result.posts[0].kind, 'video');
  assert.strictEqual(result.posts[0].viewCount, 2000);
  assert.strictEqual(result.partial, false);
});

test('fetchTikTok falls back to bio-only when the state blob is missing/malformed', async () => {
  const result = await competitorFetch.fetchCompetitorSource('tiktok', 'https://tiktok.com/@somebrand', { fetchImpl: htmlRes('<html>no state blob here</html>') });
  assert.strictEqual(result.posts.length, 0);
  assert.strictEqual(result.partial, true);
  assert.strictEqual(result.handle, 'somebrand');
});

test('fetchYouTube (no API key configured) falls back to a channel-page scrape', async () => {
  const html = '<meta property="og:title" content="Sunrise Cafe">' +
    '<script>var x = {"subscriberCountText":{"simpleText":"3.2K subscribers"}};</script>';
  const result = await competitorFetch.fetchCompetitorSource('youtube', 'https://youtube.com/@sunrisecafe', { fetchImpl: htmlRes(html) });
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.displayName, 'Sunrise Cafe');
  assert.strictEqual(result.followerCount, 3200);
  assert.strictEqual(result.partial, true);
});

test('fetchFacebook parses page name + follower count from meta tags', async () => {
  const html = '<meta property="og:title" content="Sunrise Cafe">' +
    '<meta property="og:description" content="4,500 followers - Local cafe">';
  const result = await competitorFetch.fetchCompetitorSource('facebook', 'https://facebook.com/sunrisecafe', { fetchImpl: htmlRes(html) });
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.followerCount, 4500);
});

test('fetchCompetitorSource degrades to a normalized result for an unsupported platform', async () => {
  const result = await competitorFetch.fetchCompetitorSource('twitter', 'https://twitter.com/x', {});
  assert.strictEqual(result.found, false);
  assert.ok(result.error);
});

// ---------------------------------------------------------------------------
// Unit: competitorAnalytics — deterministic, no AI involved
// ---------------------------------------------------------------------------

test('postsPerWeek averages dated posts over the trailing window', () => {
  const now = Date.now();
  const posts = [
    { postedAt: new Date(now - 1 * 24 * 3600 * 1000).toISOString() },
    { postedAt: new Date(now - 3 * 24 * 3600 * 1000).toISOString() },
    { postedAt: new Date(now - 40 * 24 * 3600 * 1000).toISOString() }, // outside the 4-week window
  ];
  assert.strictEqual(competitorAnalytics.postsPerWeek(posts, 4), 0.5); // 2 posts / 4 weeks
  assert.strictEqual(competitorAnalytics.postsPerWeek([]), null);
});

test('contentTypeMix computes shares that sum to ~1', () => {
  const posts = [{ kind: 'video' }, { kind: 'video' }, { kind: 'photo' }, { kind: 'video' }];
  const mix = competitorAnalytics.contentTypeMix(posts);
  assert.strictEqual(mix.video, 0.75);
  assert.strictEqual(mix.photo, 0.25);
});

test('statsForCompetitor rolls cadence + video share + last-posted date together', () => {
  const now = Date.now();
  const posts = [
    { kind: 'video', postedAt: new Date(now - 86400000).toISOString() },
    { kind: 'photo', postedAt: new Date(now - 2 * 86400000).toISOString() },
  ];
  const stats = competitorAnalytics.statsForCompetitor({ id: 'c1', competitor_name: 'Rival' }, posts);
  assert.strictEqual(stats.postCount, 2);
  assert.strictEqual(stats.videoSharePercent, 50);
  assert.ok(stats.lastPostedAt);
});

// ---------------------------------------------------------------------------
// Unit: ai.js competitor-trends narrative (keyless template path)
// ---------------------------------------------------------------------------

test('templateCompetitorTrends is honest when nothing is tracked at all', () => {
  const result = ai.templateCompetitorTrends({ businessName: 'Noir Coffee', competitorStats: [], trackedCompetitors: [] });
  assert.match(result.analysis, /No competitors tracked yet/);
  assert.deepStrictEqual(result.themes, []);
});

test('templateCompetitorTrends points to connecting Instagram via Meta when an Instagram-tracked competitor has no posts', () => {
  const result = ai.templateCompetitorTrends({
    businessName: 'Noir Coffee',
    competitorStats: [{ competitorName: 'SAT Station', postCount: 0, postsPerWeek: null, videoSharePercent: 0 }],
    trackedCompetitors: [{ name: 'SAT Station', followerCount: 0, platforms: ['instagram'] }],
  });
  assert.match(result.analysis, /SAT Station/);
  assert.match(result.analysis, /YOUR OWN Instagram connected via Settings/);
  assert.match(result.recommendation, /Connect your Instagram/);
});

test('templateCompetitorTrends is explicit that Facebook-only tracking structurally has no content API', () => {
  const result = ai.templateCompetitorTrends({
    businessName: 'Noir Coffee',
    competitorStats: [{ competitorName: 'FB Rival', postCount: 0, postsPerWeek: null, videoSharePercent: 0 }],
    trackedCompetitors: [{ name: 'FB Rival', followerCount: 0, platforms: ['facebook'] }],
  });
  assert.match(result.analysis, /Facebook only exposes profile info publicly/);
  assert.match(result.recommendation, /YouTube, or TikTok/);
});

test('templateCompetitorTrends gives a retry-oriented message when a non-Instagram/Facebook fetch simply failed', () => {
  const result = ai.templateCompetitorTrends({
    businessName: 'Noir Coffee',
    competitorStats: [{ competitorName: 'Rival TikTok', postCount: 0, postsPerWeek: null, videoSharePercent: 0 }],
    trackedCompetitors: [{ name: 'Rival TikTok', followerCount: null, platforms: ['tiktok'] }],
  });
  assert.match(result.analysis, /fetch may have failed or been blocked/);
  assert.match(result.recommendation, /Refresh/);
});

test('analyzeCompetitorTrends (keyless) summarizes real cadence/video-share numbers', async () => {
  const result = await ai.analyzeCompetitorTrends({
    businessName: 'Noir Coffee',
    competitorStats: [
      { competitorName: 'Rival Cafe', postCount: 10, postsPerWeek: 4, videoSharePercent: 80 },
      { competitorName: 'Bistro Nine', postCount: 6, postsPerWeek: 2, videoSharePercent: 20 },
    ],
    sampleCaptions: [],
  });
  assert.match(result.analysis, /2 tracked competitors/);
  assert.match(result.analysis, /3 posts\/week/); // average of 4 and 2
  assert.ok(result.recommendation.length > 0);
});

test('templateMediaBrief weaves in a trend note when trend context is supplied', () => {
  const brief = ai.templateMediaBrief({
    kind: 'image', mode: 'full', topic: 'latte',
    profile: { businessName: 'Noir Coffee', category: 'Cafe' },
    trends: 'Competitors are leaning heavily on short-form video.',
  });
  assert.match(brief.concept, /Inspired by a current trend/);
});

// ---------------------------------------------------------------------------
// Endpoint integration (keyless server)
// ---------------------------------------------------------------------------

let server, base;

const post = (p, body, token) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const get = (p, token) => fetch(base + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const del = (p, token) => fetch(base + p, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} });

const register = async (tag) => {
  const res = await post('/api/auth/register', { email: `${tag}${Date.now()}@m.uz`, password: 'secret123', fullName: 'P' });
  return (await res.json()).accessToken;
};
const onboard = (token, businessName = 'Noir Coffee') => post('/api/onboarding/construct', { businessName }, token);

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

test('POST /api/competitors requires auth, validates input, and never crashes even if the live fetch fails', async () => {
  const noAuth = await post('/api/competitors', { sources: [{ platform: 'instagram', url: 'https://instagram.com/x' }] });
  assert.strictEqual(noAuth.status, 401);

  const token = await register('addcomp');
  await onboard(token);

  const badInput = await post('/api/competitors', { sources: [] }, token);
  assert.strictEqual(badInput.status, 400);

  const res = await post('/api/competitors', {
    name: 'Rival Cafe',
    sources: [{ platform: 'instagram', url: 'https://instagram.com/rivalcafe_test_x' }],
  }, token);
  assert.strictEqual(res.status, 201);
  const { competitor } = await res.json();
  assert.strictEqual(competitor.competitor_name, 'Rival Cafe');
  assert.strictEqual(competitor.sources.length, 1);
  // Whether the sandbox actually reached Instagram or not, the request must
  // complete cleanly with one of the honest degrade states — never a crash.
  assert.ok(['ok', 'error', 'empty'].includes(competitor.sources[0].status));
});

test('GET /api/competitors lists tracked competitors with sources; DELETE removes them', async () => {
  const token = await register('listcomp');
  await onboard(token);
  const added = await (await post('/api/competitors', {
    sources: [{ platform: 'facebook', url: 'https://facebook.com/somepagetestxyz' }],
  }, token)).json();

  const list = await (await get('/api/competitors', token)).json();
  assert.strictEqual(list.competitors.length, 1);
  assert.strictEqual(list.competitors[0].id, added.competitor.id);

  const removed = await del(`/api/competitors/${added.competitor.id}`, token);
  assert.strictEqual(removed.status, 200);
  const listAfter = await (await get('/api/competitors', token)).json();
  assert.strictEqual(listAfter.competitors.length, 0);
});

test('POST /api/competitors/analyze is budget-gated, honest with no data, and stores + returns an insight', async () => {
  const token = await register('analyzecomp');
  await onboard(token);

  const noAuth = await post('/api/competitors/analyze', {});
  assert.strictEqual(noAuth.status, 401);

  const res = await post('/api/competitors/analyze', {}, token);
  assert.strictEqual(res.status, 200);
  const { insight } = await res.json();
  assert.match(insight.analysis.analysis, /No competitors tracked yet/);

  const trends = await (await get('/api/competitors/trends', token)).json();
  assert.strictEqual(trends.insight.id, insight.id);
});

test('POST /api/competitors/analyze explains WHY when a tracked competitor has no fetchable posts (e.g. Instagram-only)', async () => {
  const token = await register('analyzewhy');
  await onboard(token);
  await post('/api/competitors', { name: 'SAT Station', sources: [{ platform: 'instagram', url: 'https://instagram.com/sat_station_test' }] }, token);

  const res = await post('/api/competitors/analyze', {}, token);
  assert.strictEqual(res.status, 200);
  const { insight } = await res.json();
  assert.match(insight.analysis.analysis, /SAT Station/);
});

test('/api/competitors/:id/sources 404s for a competitor that belongs to a different profile', async () => {
  const token1 = await register('owner1');
  await onboard(token1);
  const added = await (await post('/api/competitors', {
    sources: [{ platform: 'youtube', url: 'https://youtube.com/@somechanneltest' }],
  }, token1)).json();

  const token2 = await register('owner2');
  await onboard(token2);
  const res = await post(`/api/competitors/${added.competitor.id}/sources`, { platform: 'tiktok', url: 'https://tiktok.com/@x' }, token2);
  assert.strictEqual(res.status, 404);
});
