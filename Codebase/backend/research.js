// Local-market research brief.
//
// Wires marketing/prompts.js `research`, which has sat complete and uncalled:
// a strict JSON contract, a hard ban on invented competitor names / prices /
// follower counts, and a required groundingFlags array in which the model
// declares its own shakiest assumptions.
//
// prompts.js assigns this lane to Gemini alone, so there is no Claude leg. With
// no key we return a deterministic template that satisfies the same contract —
// per the project rule that a blank credential degrades the answer, never the
// app.
//
// What this is NOT: per-competitor analysis. The system prompt forbids naming
// competitors, so this describes the CATEGORY and LOCATION. It is inference,
// and the UI keeps it in its own panel, visually separate from the measured
// gaps in gaps.js, so a hypothesis never borrows the authority of a
// measurement.

const gemini = require('./gemini');

const CONTRACT_FIELDS = [
  'marketSnapshot', 'trendingAngles', 'seasonalHooks',
  'competitorPlaybook', 'contentGaps', 'localNotes', 'groundingFlags',
];

const ARRAY_FIELDS = ['trendingAngles', 'seasonalHooks', 'competitorPlaybook', 'contentGaps', 'groundingFlags'];

/**
 * A model answer is only used if it actually matches the contract. A miss
 * degrades to the template rather than shipping a half-brief.
 */
function isValidBrief(b) {
  if (!b || typeof b !== 'object') return false;
  for (const f of CONTRACT_FIELDS) {
    if (!(f in b)) return false;
  }
  for (const f of ARRAY_FIELDS) {
    if (!Array.isArray(b[f])) return false;
  }
  return typeof b.marketSnapshot === 'string' && b.marketSnapshot.trim().length > 0;
}

// Durable local anchors. These are calendar facts, not predictions, which is
// why an offline brief is allowed to state them: Navruz really is late March,
// Tashkent summers really are hot. Nothing here is a claim about a competitor.
const SEASONAL_ANCHORS = [
  { hook: 'Navruz', window: 'late March', idea: 'A spring-reopening post: what is new for the season, shot in daylight.' },
  { hook: 'Ramadan / Eid', window: 'shifts each year; check the local calendar', idea: 'Iftar-hour timing and an evening-friendly offer.' },
  { hook: 'Summer heat', window: 'June to August', idea: 'The cold/quick/shaded version of your core offer.' },
  { hook: 'School start', window: 'early September', idea: 'A weekday-morning routine post aimed at parents nearby.' },
  { hook: 'Wedding season', window: 'late spring and early autumn', idea: 'Group bookings or gift options, if they fit the business.' },
  { hook: 'New Year', window: 'late December', idea: 'Opening hours over the holidays, plus one seasonal item.' },
];

/**
 * Deterministic brief, grounded in what we actually measured.
 *
 * `gaps` comes from gaps.js, so contentGaps below are derived from real
 * arithmetic over this business's own records rather than invented. Everything
 * that is genuinely a guess is marked low-confidence and flagged.
 */
function templateMarketBrief({ name, category, location, gaps = [] } = {}) {
  const cat = (category || 'local business').toLowerCase();
  const loc = location || 'Tashkent';
  const biz = name || 'this business';

  const gapCodes = new Set(gaps.map((g) => g.code));
  const contentGaps = [];
  if (gapCodes.has('noPublishedPosts')) {
    contentGaps.push({
      gap: 'Nothing has been published from Markivo yet.',
      opportunity: 'A steady weekly post beats an occasional polished one; start with what you already photograph.',
    });
  }
  if (gapCodes.has('cadenceBehind')) {
    contentGaps.push({
      gap: 'A competitor you tracked posts more often than you do.',
      opportunity: 'Match their rhythm before matching their production quality — consistency is the cheaper lever.',
    });
  }
  if (gapCodes.has('keywordsUnused')) {
    contentGaps.push({
      gap: 'Some of your target search phrases never appear in the posts you published.',
      opportunity: 'Work the exact phrase a customer would type into a caption, naturally, once per post.',
    });
  }
  if (gapCodes.has('channelGap')) {
    contentGaps.push({
      gap: 'Competitors are present on a channel you have not connected.',
      opportunity: 'Pick the one channel your customers already use daily rather than opening all of them.',
    });
  }
  if (!contentGaps.length) {
    contentGaps.push({
      gap: `Most small ${cat} accounts look interchangeable in a feed.`,
      opportunity: 'Own one repeatable, specific detail — a person, a process, a signature item — that a rival cannot copy.',
    });
  }

  return {
    marketSnapshot:
      `A small ${cat} in ${loc} typically competes inside a 1-3 km catchment, where walk-ins and word of mouth matter more `
      + `than reach. Nearby rivals are often near-identical on price and product, so the difference is usually consistency `
      + `and recognisability rather than any single campaign. This snapshot is generated from your category and location `
      + `alone, so treat it as a starting hypothesis rather than a finding.`,

    trendingAngles: [
      { angle: `Show the person behind ${biz}`, why: 'Owner-shot faces typically outperform product-only photos for local SMBs.', confidence: 'low' },
      { angle: 'One signature item, repeated', why: 'Repetition is what makes a small brand recognisable on a crowded street.', confidence: 'low' },
      { angle: 'Practical local detail (hours, parking, the exact corner)', why: 'Answers the question a nearby customer is actually asking.', confidence: 'low' },
    ],

    seasonalHooks: SEASONAL_ANCHORS.slice(0, 4),

    competitorPlaybook: [
      `Near-identical local ${cat} accounts typically post product photos with little context.`,
      'Most rely on occasional bursts of activity rather than a steady rhythm.',
      'Few answer practical questions (hours, location, availability) directly in their posts.',
      'Trilingual framing is often inconsistent, which leaves room to be the clearer one.',
    ],

    contentGaps,

    localNotes:
      `Customers in ${loc} may read Uzbek, Russian or English; keeping one language per post and alternating usually reads `
      + 'better than mixing. Cash is still common alongside card, and Telegram is often the channel people actually check.',

    // Always non-empty offline. The prompt requires the model to declare its own
    // assumptions; a template that stayed silent would be less honest than the
    // live path it stands in for.
    groundingFlags: [
      'Generated offline from your category and location, with no live market research — treat every angle as a hypothesis.',
      'No competitor was named, priced, or measured here; anything about rivals is a category-level assumption.',
      'Seasonal windows are durable calendar anchors, not verified local event dates — confirm before building a campaign on one.',
      ...(contentGaps.length && gapCodes.size
        ? ['The content gaps above are derived from your own published records, so those are measured rather than assumed.']
        : []),
    ],
  };
}

/**
 * Live brief when Gemini is configured and answers within contract; the
 * deterministic template otherwise. `engine` is surfaced to the UI as a source
 * chip so the reader always knows which one they are looking at.
 */
async function generateMarketBrief(ctx = {}) {
  const generatedAt = new Date().toISOString();
  const live = await gemini.researchBrief(ctx);
  if (isValidBrief(live)) return { ...live, engine: 'gemini', generatedAt };
  return { ...templateMarketBrief(ctx), engine: 'template', generatedAt };
}

module.exports = { generateMarketBrief, templateMarketBrief, isValidBrief, CONTRACT_FIELDS };
