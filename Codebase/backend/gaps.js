// Deterministic competitor gap analysis.
//
// Pure and db-free: arithmetic over numbers the caller already holds. It cannot
// invent a competitor, a statistic, or a trend, which is exactly why it exists.
// This is the half of Competitor Intel that is allowed to make claims to the
// owner; the AI market brief is generated separately and rendered in its own
// panel so inference never borrows the authority of measurement.
//
// Every gap is a CODE plus metrics, never a prose sentence — the same
// convention the API already uses for notice.code. The UI renders
// t('competitors.gaps.item.<code>', metrics), so the panel speaks Uzbek or
// Russian rather than English assembled on the server.
//
// A competitor metric that is null means "not reported", and nothing here may
// treat it as a zero: an unknown cadence produces a cadenceUnknown gap, never a
// "they post 0 times a week" comparison.

const round1 = (n) => Math.round(n * 10) / 10;

// Places calls it 'google'; the wizard and connection layer call the owner's
// equivalent 'googleBusiness'. Compare like with like.
const normChannel = (p) => (p === 'google' ? 'googleBusiness' : p);

/**
 * @param {object}   input
 * @param {object}   input.you              { postsPerWeek, publishedCount, sampleDays, rating, channels: { keys: [] } }
 * @param {object[]} input.competitors      API-shaped rows: { name, rating, postsPerWeek, platforms }
 * @param {string[]} input.keywordPhrases   target phrases for this business
 * @param {string[]} input.publishedTexts   the text of posts WE actually published
 * @returns {{code: string, severity: 'warn'|'info', metrics: object}[]}
 */
function computeGaps({ you = {}, competitors = [], keywordPhrases = [], publishedTexts = [] } = {}) {
  if (!competitors.length) {
    return [{ code: 'noCompetitors', severity: 'info', metrics: {} }];
  }

  const gaps = [];

  // --- posting cadence -----------------------------------------------------
  // Only competitors with a KNOWN cadence can be compared against. Since that
  // number can only have been entered by the owner, this gap is really "you vs
  // what you found out", and the UI labels it that way.
  const knownCadence = competitors.filter((c) => Number.isFinite(c.postsPerWeek));
  if (knownCadence.length) {
    const top = knownCadence.reduce((a, b) => (b.postsPerWeek > a.postsPerWeek ? b : a));
    // Our own output IS known: we published what we published, so 0 is a fact.
    const yours = Number.isFinite(you.postsPerWeek) ? you.postsPerWeek : 0;
    if (top.postsPerWeek > yours) {
      gaps.push({
        code: 'cadenceBehind',
        severity: 'warn',
        metrics: {
          name: top.name,
          theirs: round1(top.postsPerWeek),
          yours: round1(yours),
          delta: round1(top.postsPerWeek - yours),
        },
      });
    }
  }

  const unknownCadence = competitors.length - knownCadence.length;
  if (unknownCadence > 0) {
    gaps.push({ code: 'cadenceUnknown', severity: 'info', metrics: { count: unknownCadence } });
  }

  // --- our own output ------------------------------------------------------
  if (!you.publishedCount) {
    gaps.push({
      code: 'noPublishedPosts',
      severity: 'warn',
      metrics: { days: Number.isFinite(you.sampleDays) ? you.sampleDays : 28 },
    });
  }

  // --- keyword coverage ----------------------------------------------------
  // Measured against OUR OWN published post text, so it is always true. This
  // deliberately replaces the old "competitors rank for phrases you never
  // mention" card, which had no data behind it at all.
  const haystack = publishedTexts.filter(Boolean).join('\n').toLowerCase();
  const unused = keywordPhrases.filter((p) => p && !haystack.includes(String(p).toLowerCase()));
  if (keywordPhrases.length && unused.length) {
    gaps.push({
      code: 'keywordsUnused',
      severity: 'info',
      metrics: { count: unused.length, total: keywordPhrases.length, phrases: unused.slice(0, 3) },
    });
  }

  // --- channels ------------------------------------------------------------
  const yours = new Set((you.channels?.keys || []).map(normChannel));
  const theirs = new Set();
  for (const c of competitors) {
    for (const p of c.platforms || []) theirs.add(normChannel(p));
  }
  const missing = [...theirs].filter((p) => !yours.has(p));
  if (missing.length) {
    gaps.push({
      code: 'channelGap',
      severity: 'info',
      metrics: { count: missing.length, platforms: missing.slice(0, 4) },
    });
  }

  // --- Google rating -------------------------------------------------------
  // Both sides come from Places, so this is the one head-to-head comparison
  // where every number is measured by the same source.
  const rated = competitors.filter((c) => Number.isFinite(c.rating));
  if (Number.isFinite(you.rating) && rated.length) {
    const best = rated.reduce((a, b) => (b.rating > a.rating ? b : a));
    if (best.rating > you.rating) {
      gaps.push({
        code: 'ratingBehind',
        severity: 'info',
        metrics: {
          name: best.name,
          theirs: round1(best.rating),
          yours: round1(you.rating),
          delta: round1(best.rating - you.rating),
        },
      });
    }
  }

  return gaps;
}

module.exports = { computeGaps };
