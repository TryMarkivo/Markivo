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
const PLACE_1 = {
  id: 'pid_2',
  displayName: { text: 'Other Match' },
  formattedAddress: 'Elsewhere 5',
  location: { latitude: 41.32, longitude: 69.28 },
  primaryType: 'cafe',
  businessStatus: 'OPERATIONAL',
  googleMapsUri: 'https://maps.google.com/?cid=2',
  rating: 4.0,
  userRatingCount: 31,
  websiteUri: 'https://other.uz',
  nationalPhoneNumber: '+998 71 765 43 21',
};

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
const htmlResponse = (html) => ({ ok: true, status: 200, text: async () => html });

test('scanBusiness (live) calls searchText then searchNearby with exact headers and maps the result', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null });
    if (url.includes('searchText')) return okResponse({ places: [PLACE_0, PLACE_1] });
    if (url.includes('searchNearby')) return okResponse(NEARBY);
    if (url === 'https://noir.uz') return htmlResponse('<html><body>no socials here</body></html>');
    throw new Error(`unexpected url ${url}`);
  };

  const r = await places.scanBusiness({ businessName: 'Noir Coffee', location: 'Tashkent' }, { fetchImpl });

  // Exactly two GOOGLE upstream calls, correctly shaped (the third call is
  // the social sniff against the business's own website — no Google quota).
  const googleCalls = calls.filter((c) => c.url.includes('places.googleapis.com'));
  assert.strictEqual(googleCalls.length, 2);
  assert.strictEqual(calls.length, 3);
  assert.ok(googleCalls[0].url.endsWith('places:searchText'));
  assert.strictEqual(googleCalls[0].headers['X-Goog-Api-Key'], 'test_key');
  assert.strictEqual(googleCalls[0].headers['X-Goog-FieldMask'], places.SEARCH_FIELD_MASK);
  assert.deepStrictEqual(googleCalls[0].body, { textQuery: 'Noir Coffee, Tashkent', pageSize: 5 });

  assert.ok(googleCalls[1].url.endsWith('places:searchNearby'));
  assert.strictEqual(googleCalls[1].headers['X-Goog-FieldMask'], places.NEARBY_FIELD_MASK);
  assert.deepStrictEqual(googleCalls[1].body.includedTypes, ['coffee_shop']);
  assert.strictEqual(googleCalls[1].body.locationRestriction.circle.center.latitude, 41.311);

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

  // Alternatives carry the FULL mapped field set (same shape as the top match).
  assert.strictEqual(g.alternatives.length, 1);
  assert.deepStrictEqual(g.alternatives[0], {
    placeId: 'pid_2',
    name: 'Other Match',
    rating: 4.0,
    reviewsCount: 31,
    address: 'Elsewhere 5',
    verified: true,
    website: 'https://other.uz',
    phone: '+998 71 765 43 21',
    mapsUrl: 'https://maps.google.com/?cid=2',
    location: { lat: 41.32, lng: 69.28 },
    primaryType: 'cafe',
    category: 'Cafe',
  });

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

// ---------------------------------------------------------------------------
// Social sniffing (website → instagram/telegram links)
// ---------------------------------------------------------------------------

const SOCIAL_HTML = `
  <html><body>
    <a href="https://instagram.com/p/Cxyz123abc/">latest post</a>
    <a href="https://instagram.com/explore/tags/coffee/">tag</a>
    <a href="https://instagram.com/noir_uz">Follow us</a>
    <a href="https://t.me/share/url?url=x">share</a>
    <a href="https://t.me/joinchat/AAAAAEkk2WdoEd1vmJw4xw">old invite</a>
    <a href="https://t.me/noir_channel">Telegram channel</a>
  </body></html>`;

test('scanBusiness (live) sniffs the website and surfaces instagram + telegram', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('searchText')) return okResponse({ places: [PLACE_0] });
    if (url.includes('searchNearby')) return okResponse(NEARBY);
    if (url === 'https://noir.uz') return htmlResponse(SOCIAL_HTML);
    throw new Error(`unexpected url ${url}`);
  };

  const r = await places.scanBusiness({ businessName: 'Noir Coffee' }, { fetchImpl });

  assert.deepStrictEqual(r.instagram, {
    found: true,
    handle: '@noir_uz',
    url: 'https://instagram.com/noir_uz',
    source: 'website',
  });
  assert.deepStrictEqual(r.telegram, {
    found: true,
    channel: '@noir_channel',
    url: 'https://t.me/noir_channel',
    source: 'website',
    comingSoon: true,
  });
  // The rest of the scan is untouched by sniffing.
  assert.strictEqual(r.googleBusiness.found, true);
  assert.strictEqual(r.aiSearchPresence.perplexityScore, 72); // still mocked
});

test('scanBusiness (live) survives a website sniff failure (honest not-found)', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('searchText')) return okResponse({ places: [PLACE_0] });
    if (url.includes('searchNearby')) return okResponse(NEARBY);
    throw Object.assign(new Error('ECONNREFUSED'), { name: 'FetchError' });
  };

  const r = await places.scanBusiness({ businessName: 'Noir Coffee' }, { fetchImpl });
  assert.strictEqual(r.googleBusiness.found, true);
  assert.deepStrictEqual(r.instagram, { found: false });
  assert.deepStrictEqual(r.telegram, { found: false, comingSoon: true });
});

test('sniffSocialLinks ignores content paths and finds real handles', async () => {
  const fetchImpl = async () => htmlResponse(SOCIAL_HTML);
  const s = await places.sniffSocialLinks('https://noir.uz', { fetchImpl });
  assert.strictEqual(s.instagram.found, true);
  assert.strictEqual(s.instagram.handle, '@noir_uz');
  assert.strictEqual(s.telegram.found, true);
  assert.strictEqual(s.telegram.channel, '@noir_channel');
});

test('sniffSocialLinks: only content paths present → both not found', async () => {
  const fetchImpl = async () => htmlResponse(
    '<a href="https://instagram.com/reel/Cab12345/">r</a><a href="https://t.me/share?url=x">s</a>'
  );
  const s = await places.sniffSocialLinks('https://noir.uz', { fetchImpl });
  assert.deepStrictEqual(s.instagram, { found: false });
  assert.deepStrictEqual(s.telegram, { found: false, comingSoon: true });
});

test('sniffSocialLinks: fetch error and non-200 are non-fatal', async () => {
  const boom = await places.sniffSocialLinks('https://down.uz', {
    fetchImpl: async () => { throw new Error('boom'); },
  });
  assert.deepStrictEqual(boom, { instagram: { found: false }, telegram: { found: false, comingSoon: true } });

  const notOk = await places.sniffSocialLinks('https://err.uz', {
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'oops' }),
  });
  assert.deepStrictEqual(notOk, { instagram: { found: false }, telegram: { found: false, comingSoon: true } });
});
