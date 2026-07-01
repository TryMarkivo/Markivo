const config = require('./config');
const anthropic = require('./providers/anthropic');
const prompts = require('./marketing/prompts');

/**
 * Brand Identity Engine.
 *
 * Builds a deep, business-specific brand brief ONCE (positioning, value prop,
 * USP, archetype, voice spec, ideal-customer persona, content pillars, visual
 * direction) that every AI generator reads from — so output is specific to THIS
 * business instead of generic. Keyless-safe: with no Claude key it returns a
 * decent template brief derived from the profile.
 *
 * The brief is stored as JSON on the profile (db `brand_brief`). It exists in
 * two shapes that consumers must tolerate:
 *   - rich   (Claude-generated): persona/contentPillars/visualDirection are objects
 *   - flat   (template fallback): persona is a string, contentPillars a string[],
 *            palette/imageryStyle are flat top-level fields
 * briefDigest() below normalises both into one model-friendly string.
 */

// Full brand brief schema (strict, mirrors the brand architect's field set).
// A miss against this schema is caught by generateBrandBrief and degrades to
// the template, so strictness never breaks onboarding.
const BRAND_SCHEMA = {
  type: 'object',
  properties: {
    positioning: { type: 'string' },
    valueProposition: { type: 'string' },
    usp: { type: 'array', items: { type: 'string' } },
    archetype: { type: 'string' },
    voiceAdjectives: { type: 'array', items: { type: 'string' } },
    voiceDo: { type: 'array', items: { type: 'string' } },
    voiceDont: { type: 'array', items: { type: 'string' } },
    persona: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        demographics: { type: 'string' },
        context: { type: 'string' },
        motivations: { type: 'string' },
        objections: { type: 'string' },
        preferredPlatforms: { type: 'array', items: { type: 'string' } },
        languageNote: { type: 'string' },
      },
      required: ['name', 'demographics', 'context', 'motivations', 'objections', 'preferredPlatforms', 'languageNote'],
      additionalProperties: false,
    },
    contentPillars: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          purpose: { type: 'string' },
          exampleAngles: { type: 'array', items: { type: 'string' } },
          bestPlatforms: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'purpose', 'exampleAngles', 'bestPlatforms'],
        additionalProperties: false,
      },
    },
    visualDirection: {
      type: 'object',
      properties: {
        palette: { type: 'array', items: { type: 'string' } },
        typographyFeel: { type: 'string' },
        imageryStyle: { type: 'string' },
        mood: { type: 'array', items: { type: 'string' } },
        motifs: { type: 'array', items: { type: 'string' } },
      },
      required: ['palette', 'typographyFeel', 'imageryStyle', 'mood', 'motifs'],
      additionalProperties: false,
    },
    elevatorPitch: { type: 'string' },
    taglineOptions: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'positioning', 'valueProposition', 'usp', 'archetype', 'voiceAdjectives',
    'voiceDo', 'voiceDont', 'persona', 'contentPillars', 'visualDirection',
    'elevatorPitch', 'taglineOptions',
  ],
  additionalProperties: false,
};

// ${placeholder} interpolation over any string / nested structure.
const ctxVars = (ctx = {}) => ({
  name: ctx.businessName || 'our business',
  category: ctx.category || 'business',
  tone: ctx.brandTone || 'Cozy & Warm',
  audience: ctx.audience || ctx.targetAudience || 'local customers',
  location: ctx.location || 'Tashkent',
  description: ctx.description || '(not provided)',
});
const fillStr = (s, vars) =>
  typeof s === 'string' ? s.replace(/\$\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m)) : s;
const fillDeep = (v, vars) =>
  Array.isArray(v)
    ? v.map((x) => fillDeep(x, vars))
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillDeep(x, vars)]))
      : fillStr(v, vars);

/** The keyless template brief, personalised to the profile via ${placeholders}. */
function templateBrief(ctx) {
  const base = JSON.parse(JSON.stringify(prompts.brand.templateFallback));
  return fillDeep(base, ctxVars(ctx));
}

/**
 * Generate the brand brief. Live = one Claude (pipeline model) call; keyless =
 * the personalised template. Never throws — degrades to the template on any
 * failure, so onboarding is never blocked.
 */
async function generateBrandBrief(ctx = {}) {
  if (!anthropic.isLive) return templateBrief(ctx);
  try {
    const vars = ctxVars(ctx);
    const brief = await anthropic.completeJSON({
      model: config.aiPipelineModel,
      system: prompts.brand.generationSystemPrompt,
      prompt: fillStr(prompts.brand.generationUserTemplate, vars),
      schema: BRAND_SCHEMA,
      maxTokens: 2600,
    });
    return brief || templateBrief(ctx);
  } catch (err) {
    console.error('AI generateBrandBrief failed, using template:', err.message);
    return templateBrief(ctx);
  }
}

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/**
 * Compact, model-friendly digest of the brand brief, tolerant of BOTH shapes
 * (rich generated + flat template). Falls back to the thin profile when there
 * is no brief yet, so the content pipeline always has something to ground on.
 * Always carries the no-fabrication guard so the model never invents
 * prices/hours/numbers (the critic's #1 structural fix).
 */
function briefDigest(brief, profile = {}) {
  if (!brief || typeof brief !== 'object') {
    return [
      `Business: ${profile.businessName || 'a local business'}`,
      `Category: ${profile.category || 'general'}`,
      `Brand tone: ${profile.brandTone || 'Cozy & Warm'}`,
      profile.description ? `Description: ${profile.description}` : '',
      profile.targetAudience ? `Audience: ${profile.targetAudience}` : '',
      profile.location ? `Location: ${profile.location}` : '',
      'NOTE: no full brand brief yet — keep copy specific to the description above; never invent prices, hours, awards, or numbers.',
    ].filter(Boolean).join('\n');
  }

  const lines = [];
  const push = (label, val) => { if (val && String(val).trim()) lines.push(`${label}: ${val}`); };

  push('Positioning', brief.positioning);
  push('Value', brief.valueProposition);
  if (asArray(brief.usp).length) lines.push(`USP: ${asArray(brief.usp).map(String).join(' | ')}`);
  push('Archetype', brief.archetype);
  if (asArray(brief.voiceAdjectives).length) push('Voice', asArray(brief.voiceAdjectives).join(', '));
  if (asArray(brief.voiceDo).length) lines.push(`Voice DO: ${asArray(brief.voiceDo).join(' | ')}`);
  if (asArray(brief.voiceDont).length) lines.push(`Voice DON'T: ${asArray(brief.voiceDont).join(' | ')}`);

  // persona: object (rich) or string (flat)
  if (brief.persona) {
    const p = brief.persona;
    push('Persona', typeof p === 'string'
      ? p
      : [p.name, p.context || p.motivations, p.objections ? `(objection: ${p.objections})` : '']
          .filter(Boolean).join(' — '));
  }

  // contentPillars: string[] (flat) or object[] (rich)
  const pillars = asArray(brief.contentPillars).map((p) => (typeof p === 'string' ? p : p && p.name)).filter(Boolean);
  if (pillars.length) lines.push(`Content pillars: ${pillars.join(' | ')}`);

  // visual direction: flat palette/imageryStyle, or nested visualDirection{}
  const vd = brief.visualDirection || {};
  const palette = asArray(brief.palette).length ? asArray(brief.palette) : asArray(vd.palette);
  if (palette.length) push('Palette', palette.map(String).join(', '));
  push('Imagery', brief.imageryStyle || vd.imageryStyle);

  // The owner's own onboarding answers — always include verbatim so their
  // original intent is never lost to brief synthesis (the brief is a synthesis;
  // these are the ground truth they typed at signup).
  if (profile.description) lines.push(`Owner's own words (from onboarding): ${profile.description}`);
  const aud = profile.targetAudience || profile.audience;
  if (aud) lines.push(`Owner's stated audience (from onboarding): ${aud}`);

  // business facts (owner-entered) — the only source of real numbers
  const f = brief.businessFacts;
  if (f && typeof f === 'object') {
    const fl = [];
    if (asArray(f.signatureItems).length) fl.push(`signature: ${asArray(f.signatureItems).join(', ')}`);
    if (f.pricePoints) fl.push(`prices: ${f.pricePoints}`);
    if (f.hours) fl.push(`hours: ${f.hours}`);
    if (f.bookingLink) fl.push(`booking: ${f.bookingLink}`);
    if (f.phone) fl.push(`phone: ${f.phone}`);
    if (f.offer && (f.offer.value || f.offer.type)) {
      fl.push(`offer: ${[f.offer.type, f.offer.value, f.offer.deadline].filter(Boolean).join(' ')}`);
    }
    lines.push(fl.length
      ? `FACTS (use ONLY these; never invent prices/hours/numbers): ${fl.join(' | ')}`
      : 'FACTS: none provided — do NOT invent prices, hours, or numbers; write so the owner can drop them in.');
  } else {
    lines.push('FACTS: none provided — do NOT invent prices, hours, or numbers; write so the owner can drop them in.');
  }

  return lines.join('\n');
}

module.exports = {
  fields: prompts.brand.fields,
  generateBrandBrief,
  templateBrief,
  briefDigest,
};
