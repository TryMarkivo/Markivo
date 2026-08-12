// Deterministic (no AI) competitor content statistics, computed straight from
// stored competitor_posts rows — so cadence and content-type-mix numbers are
// always available instantly, regardless of AI budget or provider state.
// Only the qualitative "themes"/"recommendation" narrative (ai.js#
// analyzeCompetitorTrends) needs a model; these numbers never do.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Posts per week, averaged over the trailing `weeks` window ending now.
// null = no dated posts to measure from (distinct from 0 = measured, none found).
function postsPerWeek(posts, weeks = 4) {
  const dated = posts.filter((p) => p.postedAt);
  if (!dated.length) return null;
  const since = Date.now() - weeks * WEEK_MS;
  const recent = dated.filter((p) => new Date(p.postedAt).getTime() >= since);
  return Math.round((recent.length / weeks) * 10) / 10;
}

// { video: 0.6, photo: 0.3, unknown: 0.1 } — share of each `kind` seen, sums to ~1.
function contentTypeMix(posts) {
  if (!posts.length) return {};
  const counts = {};
  for (const p of posts) {
    const k = p.kind || 'unknown';
    counts[k] = (counts[k] || 0) + 1;
  }
  const total = posts.length;
  const mix = {};
  for (const [k, n] of Object.entries(counts)) mix[k] = Math.round((n / total) * 100) / 100;
  return mix;
}

function lastPostedAt(posts) {
  return posts.reduce((max, p) => (p.postedAt && (!max || p.postedAt > max) ? p.postedAt : max), null);
}

function statsForCompetitor(competitor, posts) {
  const mix = contentTypeMix(posts);
  return {
    competitorId: competitor.id,
    competitorName: competitor.competitor_name,
    postCount: posts.length,
    postsPerWeek: postsPerWeek(posts),
    contentTypeMix: mix,
    videoSharePercent: Math.round((mix.video || 0) * 100),
    lastPostedAt: lastPostedAt(posts),
  };
}

// One stats row per competitor — feeds both the CompetitorIntel dashboard
// chart and the grounding context for ai.js#analyzeCompetitorTrends.
function buildCompetitorStats(competitors, postsByCompetitorId) {
  return competitors.map((c) => statsForCompetitor(c, postsByCompetitorId[c.id] || []));
}

module.exports = { postsPerWeek, contentTypeMix, statsForCompetitor, buildCompetitorStats };
