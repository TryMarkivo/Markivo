const { test } = require('node:test');
const assert = require('node:assert');

const { computeGaps } = require('../gaps');

const codes = (gaps) => gaps.map((g) => g.code);
const byCode = (gaps, code) => gaps.find((g) => g.code === code);

test('no competitors yields a single noCompetitors gap and nothing else', () => {
  const gaps = computeGaps({ you: { postsPerWeek: 0, publishedCount: 0 }, competitors: [] });
  assert.deepStrictEqual(codes(gaps), ['noCompetitors']);
});

test('an unknown competitor cadence never becomes a "they post 0" comparison', () => {
  const gaps = computeGaps({
    you: { postsPerWeek: 3, publishedCount: 12, channels: { keys: ['instagram'] } },
    competitors: [
      { name: 'Brew District', postsPerWeek: null, platforms: ['instagram'] },
      { name: 'Kofe Hona', postsPerWeek: null, platforms: ['instagram'] },
    ],
  });
  assert.ok(!codes(gaps).includes('cadenceBehind'), 'nulls cannot produce a cadence comparison');
  assert.strictEqual(byCode(gaps, 'cadenceUnknown').metrics.count, 2);
});

test('cadenceBehind compares against the fastest KNOWN competitor only', () => {
  const gaps = computeGaps({
    you: { postsPerWeek: 2, publishedCount: 8, channels: { keys: ['instagram'] } },
    competitors: [
      { name: 'Slow Cafe', postsPerWeek: 1, platforms: ['instagram'] },
      { name: 'Brew District', postsPerWeek: 6, platforms: ['instagram'] },
      { name: 'Unknown Co', postsPerWeek: null, platforms: ['instagram'] },
    ],
  });
  const g = byCode(gaps, 'cadenceBehind');
  assert.strictEqual(g.metrics.name, 'Brew District');
  assert.strictEqual(g.metrics.theirs, 6);
  assert.strictEqual(g.metrics.yours, 2);
  assert.strictEqual(g.metrics.delta, 4);
  assert.strictEqual(g.severity, 'warn');
  // The one unknown is still reported separately.
  assert.strictEqual(byCode(gaps, 'cadenceUnknown').metrics.count, 1);
});

test('posting more than every known competitor produces no cadence gap', () => {
  const gaps = computeGaps({
    you: { postsPerWeek: 9, publishedCount: 36, channels: { keys: ['instagram'] } },
    competitors: [{ name: 'Brew District', postsPerWeek: 6, platforms: ['instagram'] }],
  });
  assert.ok(!codes(gaps).includes('cadenceBehind'));
});

test('keyword coverage is measured against our own published text', () => {
  const gaps = computeGaps({
    you: { postsPerWeek: 1, publishedCount: 2, channels: { keys: ['instagram'] } },
    competitors: [{ name: 'X', postsPerWeek: 1, platforms: ['instagram'] }],
    keywordPhrases: ['best coffee in tashkent', 'coffee near me', 'specialty roast'],
    publishedTexts: ['Come try the BEST COFFEE IN TASHKENT this weekend', 'New beans in stock'],
  });
  const g = byCode(gaps, 'keywordsUnused');
  assert.strictEqual(g.metrics.count, 2, 'the phrase we did use is not counted as a gap');
  assert.strictEqual(g.metrics.total, 3);
  assert.deepStrictEqual(g.metrics.phrases, ['coffee near me', 'specialty roast']);
});

test('every phrase used means no keyword gap at all', () => {
  const gaps = computeGaps({
    you: { postsPerWeek: 1, publishedCount: 1, channels: { keys: ['instagram'] } },
    competitors: [{ name: 'X', postsPerWeek: 1, platforms: ['instagram'] }],
    keywordPhrases: ['coffee near me'],
    publishedTexts: ['looking for coffee near me? we are open'],
  });
  assert.ok(!codes(gaps).includes('keywordsUnused'));
});

test('channelGap normalises Places "google" against our "googleBusiness"', () => {
  const gaps = computeGaps({
    you: { postsPerWeek: 1, publishedCount: 1, channels: { keys: ['googleBusiness'] } },
    competitors: [{ name: 'X', postsPerWeek: 1, platforms: ['google', 'instagram'] }],
  });
  const g = byCode(gaps, 'channelGap');
  assert.deepStrictEqual(g.metrics.platforms, ['instagram'], 'google == googleBusiness, so only instagram is missing');
});

test('noPublishedPosts fires on a real zero and carries the window', () => {
  const gaps = computeGaps({
    you: { postsPerWeek: 0, publishedCount: 0, sampleDays: 28, channels: { keys: ['instagram'] } },
    competitors: [{ name: 'X', postsPerWeek: null, platforms: ['instagram'] }],
  });
  const g = byCode(gaps, 'noPublishedPosts');
  assert.strictEqual(g.metrics.days, 28);
  assert.strictEqual(g.severity, 'warn');
});

test('ratingBehind only fires when both sides have a real rating', () => {
  const unrated = computeGaps({
    you: { rating: null, postsPerWeek: 1, publishedCount: 1, channels: { keys: ['instagram'] } },
    competitors: [{ name: 'X', rating: 4.8, postsPerWeek: 1, platforms: ['instagram'] }],
  });
  assert.ok(!codes(unrated).includes('ratingBehind'), 'an unrated business is not "behind"');

  const behind = computeGaps({
    you: { rating: 4.2, postsPerWeek: 1, publishedCount: 1, channels: { keys: ['instagram'] } },
    competitors: [
      { name: 'X', rating: 4.8, postsPerWeek: 1, platforms: ['instagram'] },
      { name: 'Y', rating: null, postsPerWeek: 1, platforms: ['instagram'] },
    ],
  });
  const g = byCode(behind, 'ratingBehind');
  assert.strictEqual(g.metrics.name, 'X');
  assert.strictEqual(g.metrics.delta, 0.6);
});

test('every gap is a translatable code with metrics, never a prose sentence', () => {
  const gaps = computeGaps({
    you: { postsPerWeek: 0, publishedCount: 0, rating: 4.0, channels: { keys: [] } },
    competitors: [
      { name: 'A', rating: 4.9, postsPerWeek: 8, platforms: ['instagram', 'telegram'] },
      { name: 'B', rating: null, postsPerWeek: null, platforms: ['google'] },
    ],
    keywordPhrases: ['x phrase'],
    publishedTexts: [],
  });
  assert.ok(gaps.length >= 4);
  for (const g of gaps) {
    assert.match(g.code, /^[a-zA-Z]+$/, 'code must be an identifier the UI can translate');
    assert.ok(['warn', 'info'].includes(g.severity));
    assert.strictEqual(typeof g.metrics, 'object');
    assert.ok(!/\s/.test(g.code), 'a code is not a sentence');
  }
});
