// ==========================================================================
// Business context — the per-business "memory cell".
//
// Gemini's API is stateless per call: there is no server-side memory we can
// attach to a business. So "memory" here means exactly this:
//
//   1. When a business profile is created, we send the owner's profile to
//      Gemini and get back a distilled working context (what the business does,
//      its tone, its audience, its selling points). Whenever the owner later
//      tells us something new — a profile edit, an answered question, a fact
//      Markiv saved from chat, edited business facts — the cell is re-distilled
//      in the background, so the memory grows with the business.
//   2. We store that distillation ourselves as ONE row keyed by business id —
//      `business_contexts` has UNIQUE(profile_id), so it is literally one cell
//      per business, not a shared prompt blob.
//   3. Every later generation for that business receives `memoryDigest()`: the
//      cell plus the brand brief, the owner's own facts, what they actually
//      published, and the ads already made — instead of re-deriving the
//      business from five onboarding fields.
//
// Isolation follows from (2) + (3): a prompt is built from ONE business's cell,
// looked up by its own id, so another business's context cannot leak in.
//
// Markivo rule: a blank credential never breaks the app. With no GEMINI_API_KEY
// `createBusinessContext` stores a deterministic template cell instead, so the
// row always exists and downstream callers never have to special-case "keyless".
// This function never throws — profile creation must not fail because an AI
// provider was unreachable.
// ==========================================================================

const gemini = require('./gemini');
const brand = require('./brand');
const preferences = require('./preferences');

// Deterministic fallback cell, built only from what the owner actually typed.
// Exported so the keyless contract is unit-tested rather than assumed.
function templateContext(profileData) {
  const { businessName, category, description, tone, audience, location } = profileData || {};
  const name = (businessName && String(businessName).trim()) || 'This business';
  const cat = (category && String(category).trim()) || 'business';
  const desc = (description && String(description).trim()) || '';

  const summary = desc
    ? `${name} is a ${cat.toLowerCase()}${location ? ` in ${location}` : ''}. In the owner's own words: ${desc}`
    : `${name} is a ${cat.toLowerCase()}${location ? ` in ${location}` : ''}.`;

  // Selling points are only ever things the owner stated — never invented.
  const sellingPoints = [
    `Category: ${cat}`,
    desc ? `What they do: ${desc.slice(0, 160)}` : null,
    audience ? `Serves: ${String(audience).slice(0, 120)}` : null,
    location ? `Based in ${location}` : null,
  ].filter(Boolean);

  return {
    summary,
    tone: (tone && String(tone).trim()) || 'Cozy & Warm',
    audience: (audience && String(audience).trim()) || 'local customers',
    sellingPoints,
  };
}

// Build the context cell for a business and store it, at profile creation.
// Later changes go through refreshBusinessContext below.
async function createBusinessContext(db, businessId, profileData) {
  let derived = null;
  try {
    derived = await gemini.generateBusinessContext(profileData);
  } catch (err) {
    // gemini.generateBusinessContext already swallows its own errors, so this
    // only catches something truly unexpected. Still non-fatal.
    console.error('generateBusinessContext threw unexpectedly, using template:', err.message);
  }

  const cell = derived || templateContext(profileData);
  try {
    return db.businessContext.upsert({
      profileId: businessId,
      summary: cell.summary,
      tone: cell.tone,
      audience: cell.audience,
      sellingPoints: cell.sellingPoints,
      source: derived ? 'gemini' : 'template',
    });
  } catch (err) {
    console.error('Storing the business context failed (non-fatal):', err.message);
    return null;
  }
}

// Read the stored cell for a business. Returns null when none exists yet (e.g.
// a profile created before this feature, or a wizard step that runs before
// `construct`) — callers must handle that rather than assume a cell is there.
function getBusinessContext(db, businessId) {
  try {
    return db.businessContext.get(businessId);
  } catch (err) {
    console.error('Reading the business context failed (non-fatal):', err.message);
    return null;
  }
}

// The single re-injection point: turn a stored cell into the prompt block that
// every downstream generator for this business receives. Returns '' for a
// missing cell so callers can branch on falsiness.
function contextDigest(context) {
  if (!context || !context.summary) return '';
  const lines = ['BUSINESS CONTEXT (stored for this business — treat as ground truth):'];
  lines.push(context.summary);
  if (context.tone) lines.push(`Tone/voice: ${context.tone}`);
  if (context.audience) lines.push(`Audience: ${context.audience}`);
  const pts = Array.isArray(context.sellingPoints) ? context.sellingPoints.filter(Boolean) : [];
  if (pts.length) lines.push(`Key selling points: ${pts.join(' | ')}`);
  lines.push('Never invent prices, hours, awards, or numbers that are not stated above.');
  return lines.join('\n');
}

// What the owner has told us beyond the signup form, in their own words: the
// answered profile questions and the business facts. This is what a refresh
// folds into the cell — never the synthesised brand brief, so the cell stays a
// record of what the owner said rather than of what a model inferred.
function ownerDetails(profile) {
  const facts = brand.factsLine(profile.brandBrief && profile.brandBrief.businessFacts);
  return [brand.answeredDetails(profile), facts ? `Business facts: ${facts}` : ''].filter(Boolean).join('\n');
}

const refreshing = new Map(); // profileId -> { again, promise }

/**
 * Re-distil the cell from the business as it is NOW. Fire-and-forget from any
 * route that changes what we know about the business; never throws.
 *
 * A failed or keyless refresh keeps the existing cell — an outdated memory is
 * better than one overwritten by a template. Saves that land while a refresh
 * is running are coalesced into one more pass, so a burst of answers costs at
 * most two model calls and the last pass always sees the latest profile.
 */
function refreshBusinessContext(db, profileId) {
  if (!gemini.enabled || !profileId) return Promise.resolve(null);
  const running = refreshing.get(profileId);
  if (running) {
    running.again = true;
    return running.promise;
  }

  const state = { again: false };
  state.promise = (async () => {
    let cell = null;
    do {
      state.again = false;
      const profile = db.profiles.findById(profileId);
      if (!profile) break;
      const derived = await gemini.generateBusinessContext({
        businessName: profile.businessName,
        category: profile.category,
        description: profile.description,
        tone: profile.brandTone,
        audience: profile.targetAudience,
        location: profile.location,
        details: ownerDetails(profile),
      });
      if (derived) cell = db.businessContext.upsert({ profileId, ...derived, source: 'gemini' });
    } while (state.again);
    return cell;
  })()
    .catch((err) => {
      console.error('Refreshing the business context failed (non-fatal):', err.message);
      return null;
    })
    .finally(() => refreshing.delete(profileId));
  refreshing.set(profileId, state);
  return state.promise;
}

// The last few full-mode ads made for this business, so a new one stays
// consistent with them without repeating their headline.
function recentAdsDigest(items) {
  const ads = (Array.isArray(items) ? items : [])
    .filter((m) => m && m.mode === 'full' && m.brief && (m.brief.headline || m.brief.concept))
    .slice(0, 3)
    .map((m) => `- ${m.kind}: ${m.brief.headline ? `"${m.brief.headline}"` : String(m.brief.concept).slice(0, 140)}` +
      `${m.topic ? ` (asked for: ${String(m.topic).slice(0, 120)})` : ''}`);
  return ads.length
    ? `ADS ALREADY MADE FOR THIS BUSINESS (keep the look consistent; do not repeat a headline):\n${ads.join('\n')}`
    : '';
}

/**
 * Everything Markivo remembers about ONE business, as the single prompt block
 * every generator receives: the stored context cell, the brand brief with the
 * owner's own answers and facts, the posts they actually published, and the
 * ads already made. Each part is looked up by this business's id only. Never
 * throws — a part that cannot be read is left out, not fatal.
 */
function memoryDigest(db, profile) {
  if (!profile) return '';
  const read = (fn) => {
    try { return fn(); } catch (err) {
      console.error('Reading part of the business memory failed (non-fatal):', err.message);
      return '';
    }
  };
  return [
    contextDigest(getBusinessContext(db, profile.id)),
    `BRAND BRIEF AND OWNER FACTS:\n${brand.briefDigest(profile.brandBrief, profile)}`,
    read(() => preferences.preferenceDigest(db.feedback.recentExamples(profile.id))),
    read(() => recentAdsDigest(db.media.listByProfile(profile.id))),
  ].filter(Boolean).join('\n\n');
}

module.exports = {
  createBusinessContext,
  refreshBusinessContext,
  getBusinessContext,
  contextDigest,
  memoryDigest,
  templateContext,
};
