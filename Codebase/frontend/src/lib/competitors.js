// Presentation helpers for Competitor Intel.
//
// One place to decode the /api/competitors payload, so the table, the chart and
// the gap list can never drift apart about what "unknown" means. The rule this
// file exists to enforce: a metric nobody measured is absent, not zero.

// The API marks genuinely-missing metrics in `unavailable` — the same field
// name and shape /api/dashboard/platform/:key uses. Read that rather than
// testing `== null` independently in three components.
export const unknownSet = (row) => new Set((row && row.unavailable) || []);
export const isUnknown = (row, field) => unknownSet(row).has(field);

// Where a number came from: 'telegram' (measured), 'manual' (the owner typed
// it), 'google_places', or null when the field is unknown.
export const sourceOf = (row, field) => (row && row.metricSources && row.metricSources[field]) || null;

// Competitors whose cadence somebody actually established. Everyone else is
// absent from the comparison, never a zero in it.
export const knownCadence = (rows = []) => rows.filter((r) => Number.isFinite(r.postsPerWeek));

/**
 * Bars for the cadence benchmark: the business first, then every competitor
 * whose cadence is known.
 *
 * Returns [] when no competitor has a known cadence — a chart of yourself alone
 * is not a benchmark, and the caller renders an empty state instead.
 */
export function benchmarkSeries(you, rows = []) {
  const known = knownCadence(rows);
  if (!known.length) return [];

  const series = known
    .map((r) => ({
      id: r.id,
      label: r.name,
      value: r.postsPerWeek,
      self: false,
      source: sourceOf(r, 'postsPerWeek'),
    }))
    .sort((a, b) => b.value - a.value);

  // Our own cadence is always known — we published what we published — so it is
  // always on the chart, even at zero.
  if (you && Number.isFinite(you.postsPerWeek)) {
    series.unshift({ id: '__you__', label: you.name, value: you.postsPerWeek, self: true, source: 'markivo' });
  }
  return series;
}

// How many competitors have no cadence on file. Shown next to the chart so the
// absence is visible rather than silently omitted.
export const unknownCadenceCount = (rows = []) => rows.length - knownCadence(rows).length;

export const formatCount = (n, locale) => (Number.isFinite(n) ? n.toLocaleString(locale) : null);

// Cadence is often fractional for us (3 posts in 28 days = 0.75/wk) and whole
// for a hand-entered competitor. Show at most one decimal, and no trailing .0.
export const formatCadence = (n) => (Number.isFinite(n) ? String(Math.round(n * 10) / 10) : null);
