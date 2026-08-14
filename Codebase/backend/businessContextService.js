// ==========================================================================
// Business context — the per-business "memory cell".
//
// Gemini's API is stateless per call: there is no server-side memory we can
// attach to a business. So "memory" here means exactly this:
//
//   1. ONCE, when a business profile is created, we send the owner's profile to
//      Gemini and get back a distilled working context (what the business does,
//      its tone, its audience, its selling points).
//   2. We store that distillation ourselves as ONE row keyed by business id —
//      `business_contexts` has UNIQUE(profile_id), so it is literally one cell
//      per business, not a shared prompt blob.
//   3. Every later generation for that business re-injects the stored cell via
//      `contextDigest()` instead of re-deriving the business from scratch.
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

// Build the context cell for a business and store it. Called ONCE, at profile
// creation — not re-triggered on later actions.
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

module.exports = {
  createBusinessContext,
  getBusinessContext,
  contextDigest,
  templateContext,
};
