const { test } = require('node:test');
const assert = require('node:assert');

// Live-mode tests: set the key BEFORE requiring places.js (config caches env
// at load; node --test runs each file in its own process, so this never
// leaks into other suites). All Google traffic is stubbed via fetchImpl.
process.env.GOOGLE_MAPS_API_KEY = 'test_key';
process.env.NODE_ENV = 'test';

const places = require('../places');

const PLACE_0 = {
  id: 'pid_1',
  displayName: { text: 'Noir Coffee & Workspace' },
  formattedAddress: 'Amir Temur 12, Tashkent',
  location: { latitude: 41.311, longitude: 69.279 },
  primaryType: 'coffee_shop',
  types: ['coffee_shop', 'cafe'],
  businessStatus: 'OPERATIONAL',
  googleMapsUri: 'https://maps.google.com/?cid=1',
  rating: 4.6,
  userRatingCount: 89,
  websiteUri: 'https://noir.uz',
  nationalPhoneNumber: '+998 71 123 45 67',
};
const PLACE_1 = { id: 'pid_2', displayName: { text: 'Other Match' }, formattedAddress: 'Elsewhere 5', rating: 4.0 };

const NEARBY = {
  places: [
    { id: 'pid_1', displayName: { text: 'Noir Coffee & Workspace' }, rating: 4.6 }, // the business itself
    { id: 'pid_3', displayName: { text: 'Brew District' }, formattedAddress: 'Mirzo 3', rating: 4.5 },
    { id: 'pid_4', displayName: { text: 'Kofe Hona' }, formattedAddress: 'Chilanzar 9', rating: 4.3 },
    { id: 'pid_5', displayName: { text: 'Cup & Co' }, formattedAddress: 'Yunusobod 1', rating: 4.2 },
    { id: 'pid_6', displayName: { text: 'Extra Shop' }, formattedAddress: 'Sergeli 2', rating: 4.0 },
  ],
};

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });

test('scanBusiness (live) calls searchText then searchNearby with exact headers and maps the result', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    if (url.includes('searchText')) return okResponse({ places: [PLACE_0, PLACE_1] });
    if (url.includes('searchNearby')) return okResponse(NEARBY);
    throw new Error(`unexpected url ${url}`);
  };

  const r = await places.scanBusiness({ businessName: 'Noir Coffee', location: 'Tashkent' }, { fetchImpl });

  // Exactly two upstream calls, correctly shaped.
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[0].url.endsWith('places:searchText'));
  assert.strictEqual(calls[0].headers['X-Goog-Api-Key'], 'test_key');
  assert.strictEqual(calls[0].headers['X-Goog-FieldMask'], places.SEARCH_FIELD_MASK);
  assert.deepStrictEqual(calls[0].body, { textQuery: 'Noir Coffee, Tashkent', pageSize: 5 });

  assert.ok(calls[1].url.endsWith('places:searchNearby'));
  assert.strictEqual(calls[1].headers['X-Goog-FieldMask'], places.NEARBY_FIELD_MASK);
  assert.deepStrictEqual(calls[1].body.includedTypes, ['coffee_shop']);
  assert.strictEqual(calls[1].body.locationRestriction.circle.center.latitude, 41.311);

  // Mapping — legacy keys keep their names; additive fields present.
  assert.strictEqual(r.live, true);
  const g = r.googleBusiness;
  assert.strictEqual(g.found, true);
  assert.strictEqual(g.placeId, 'pid_1');
  assert.strictEqual(g.name, 'Noir Coffee & Workspace');
  assert.strictEqual(g.rating, 4.6);
  assert.strictEqual(g.reviewsCount, 89);
  assert.strictEqual(g.address, 'Amir Temur 12, Tashkent');
  assert.strictEqual(g.verified, true);
  assert.strictEqual(g.website, 'https://noir.uz');
  assert.strictEqual(g.category, 'Coffee Shop');
  assert.strictEqual(g.alternatives.length, 1);
  assert.strictEqual(g.alternatives[0].placeId, 'pid_2');

  // Competitors: business itself filtered out, capped at 3, honest nulls.
  assert.strictEqual(r.competitors.length, 3);
  assert.ok(!r.competitors.some((c) => c.placeId === 'pid_1'));
  assert.deepStrictEqual(r.competitors.map((c) => c.competitorName), ['Brew District', 'Kofe Hona', 'Cup & Co']);
  assert.strictEqual(r.competitors[0].followersCount, null);

  // Honesty policy with a live key.
  assert.strictEqual(r.instagram.found, false);
  assert.strictEqual(r.telegram.found, false);
  assert.strictEqual(r.telegram.comingSoon, true);
  assert.strictEqual(r.aiSearchPresence.perplexityScore, 72); // still mocked (future milestone)
});

test('scanBusiness (live) zero results → found:false, no nearby call', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return okResponse({ places: [] }); };

  const r = await places.scanBusiness({ businessName: 'Ghost Biz' }, { fetchImpl });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(r.googleBusiness.found, false);
  assert.deepStrictEqual(r.googleBusiness.alternatives, []);
  assert.deepStrictEqual(r.competitors, []);
});

test('scanBusiness (live) propagates Google HTTP errors as PlacesApiError', async () => {
  const fetchImpl = async () => ({
    ok: false, status: 403,
    json: async () => ({ error: { message: 'API key not authorized' } }),
  });
  await assert.rejects(
    places.scanBusiness({ businessName: 'Noir' }, { fetchImpl }),
    (err) => err instanceof places.PlacesApiError && err.status === 403 && /not authorized/.test(err.message)
  );
});

test('scanBusiness (live) survives a nearby-search failure (competitors: [])', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('searchText')) return okResponse({ places: [PLACE_0] });
    throw Object.assign(new Error('boom'), { name: 'FetchError' });
  };
  const r = await places.scanBusiness({ businessName: 'Noir' }, { fetchImpl });
  assert.strictEqual(r.googleBusiness.found, true);
  assert.deepStrictEqual(r.competitors, []);
});

test('timeouts map to PlacesApiError', async () => {
  const fetchImpl = async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); };
  await assert.rejects(
    places.searchText({ textQuery: 'x' }, { fetchImpl }),
    (err) => err instanceof places.PlacesApiError && /timed out/i.test(err.message)
  );
});
