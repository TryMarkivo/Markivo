// Google Gemini text generation — the social-copy and message-template engine.
//
// Talks to the Generative Language REST API directly with global fetch (same
// approach as mediagen.js / places.js) so no extra SDK dependency is pulled in:
//   POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent?key=<key>
// Docs: https://ai.google.dev/api/generate-content
//
// Markivo rule: a BLANK credential must never break the app or the tests. With
// no GEMINI_API_KEY every export falls back to a deterministic result — copy
// falls back to the ai.js templates (via the caller), and template extraction
// falls back to the heuristic parser below, which is genuinely useful on its
// own (it finds the numbers in "Stadium No:141, 9 spots left" without any AI).

const config = require('./config');
const prompts = require('./marketing/prompts');

const API_HOST = 'https://generativelanguage.googleapis.com/v1beta';

// ${placeholder} interpolation for the authored prompt templates (same helper
// shape as ai.js — the templates are shared authoring, not shared code).
const fill = (tmpl, vars) =>
  String(tmpl).replace(/\$\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));

// ===========================================================================
// LOW-LEVEL CLIENT
// ===========================================================================

// Gemini's responseSchema is the OpenAPI 3.0 subset: UPPERCASE type names and
// no `additionalProperties`. `propertyOrdering` nudges the model to emit fields
// in a stable order, which measurably improves adherence.
// Docs: https://ai.google.dev/gemini-api/docs/structured-output
async function callGemini({ system, user, schema, maxTokens = 1500, temperature = 0.8 }) {
  if (!config.geminiEnabled) throw new Error('Gemini is not configured');

  const body = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
      ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}),
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const url = `${API_HOST}/models/${encodeURIComponent(config.geminiTextModel)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.geminiTimeoutMs),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || `HTTP ${res.status}`;
    throw new Error(`Gemini request failed: ${msg}`);
  }

  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const text = parts.map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned an empty response');
  return schema ? JSON.parse(text) : text;
}

// ===========================================================================
// TEMPLATE PRIMITIVES (deterministic — no AI, shared by every code path)
// ===========================================================================

// Placeholders are {{snake_case_key}} so a template is readable, safely
// round-trippable through JSON, and renderable without a parser.
const PLACEHOLDER = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

// Turn free text into a usable variable key: "Stadium No" -> "stadium_no".
function toKey(raw, fallbackIndex = 1) {
  const key = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return key || `value_${fallbackIndex}`;
}

const humanize = (key) =>
  String(key || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// Every distinct {{key}} in a template, in first-appearance order. The template
// TEXT is the source of truth for which variables exist — the variables array
// only decorates them with labels and examples.
function extractVariables(templateText) {
  const seen = [];
  for (const m of String(templateText || '').matchAll(PLACEHOLDER)) {
    const key = m[1].toLowerCase();
    if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}

// Reconcile a client-supplied variable list against the placeholders actually
// present in the text: drop orphans, add any placeholder that has no entry yet.
function reconcileVariables(templateText, variables = []) {
  const keys = extractVariables(templateText);
  const byKey = new Map(
    (Array.isArray(variables) ? variables : [])
      .filter((v) => v && v.key)
      .map((v) => [String(v.key).toLowerCase(), v])
  );
  return keys.map((key) => {
    const v = byKey.get(key) || {};
    return {
      key,
      label: String(v.label || humanize(key)).slice(0, 60),
      example: String(v.example == null ? '' : v.example).slice(0, 120),
    };
  });
}

// Fill a template. Missing values render as a blank run so the owner can see at
// a glance what is still unfilled — matching how the template reads in the UI.
function renderTemplate(templateText, values = {}) {
  return String(templateText || '').replace(PLACEHOLDER, (_, rawKey) => {
    const key = rawKey.toLowerCase();
    const val = values[key];
    return val == null || val === '' ? '____' : String(val);
  });
}

// Human-readable preview: "Stadium No:{{no}}" -> "Stadium No:____".
const blankPreview = (templateText) => renderTemplate(templateText, {});

// ===========================================================================
// HEURISTIC TEMPLATE EXTRACTION (the keyless fallback)
// ===========================================================================

// Numbers are what actually varies in the message formats businesses reuse
// ("Stadium No:141, 9 spots left ✅", "Table 4 · 2 seats · 19:00"), so the
// offline parser turns every number run into a variable and names it from the
// words around it. Not as smart as Gemini, but never wrong in a surprising way.
const NUMBER_RUN = /\d+(?:[.,:]\d+)*/g;
const WORD = /[\p{L}]+/gu;

// Name a variable from the words immediately before the number, falling back to
// the words after it ("9 spots left" has nothing useful in front of the 9).
function nameFromContext(before, after, index) {
  const wordsBefore = (before.match(WORD) || []).slice(-2);
  if (wordsBefore.length) return toKey(wordsBefore.join('_'), index);
  const wordsAfter = (after.match(WORD) || []).slice(0, 2);
  if (wordsAfter.length) return toKey(wordsAfter.join('_'), index);
  return `value_${index}`;
}

function heuristicTemplate(sample, { platform } = {}) {
  const text = String(sample || '');
  const matches = [...text.matchAll(NUMBER_RUN)];

  let out = '';
  let cursor = 0;
  const variables = [];
  const used = new Set();

  matches.forEach((m, i) => {
    // Context is bounded by the NEIGHBOURING numbers, not the whole message —
    // otherwise the "9" in "Stadium No:141, 9 spots left" would be named after
    // the "Stadium No" that belongs to the 141.
    const prevEnd = i === 0 ? 0 : matches[i - 1].index + matches[i - 1][0].length;
    const nextStart = i === matches.length - 1 ? text.length : matches[i + 1].index;
    const end = m.index + m[0].length;
    let key = nameFromContext(text.slice(prevEnd, m.index), text.slice(end, nextStart), i + 1);
    // Two "Stadium No" numbers in one message must not collide on one key.
    if (used.has(key)) {
      let n = 2;
      while (used.has(`${key}_${n}`)) n += 1;
      key = `${key}_${n}`;
    }
    used.add(key);
    variables.push({ key, label: humanize(key), example: m[0] });
    out += text.slice(cursor, m.index) + `{{${key}}}`;
    cursor = m.index + m[0].length;
  });
  out += text.slice(cursor);

  return {
    name: defaultName(text, platform),
    templateText: out,
    variables,
    source: 'heuristic',
  };
}

// A short, recognisable title from the first few words of the sample.
function defaultName(sample, platform) {
  const words = (String(sample || '').match(/[\p{L}\p{N}#@]+/gu) || []).slice(0, 4).join(' ');
  return (words || `${platform || 'Post'} template`).slice(0, 60);
}

// ===========================================================================
// LIVE GENERATION (Gemini) — each wraps a fallback so callers never throw
// ===========================================================================

const TEMPLATE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    templateText: { type: 'STRING' },
    variables: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          key: { type: 'STRING' },
          label: { type: 'STRING' },
          example: { type: 'STRING' },
        },
        required: ['key', 'label', 'example'],
        propertyOrdering: ['key', 'label', 'example'],
      },
    },
  },
  required: ['name', 'templateText', 'variables'],
  propertyOrdering: ['name', 'templateText', 'variables'],
};

// Analyze one real message an owner sends and turn it into a reusable template
// with {{variables}} where the changing parts are. Keyless -> heuristic parser.
async function analyzeTemplate(ctx) {
  const { sample, platform, businessName, category } = ctx;
  if (!config.geminiEnabled) return heuristicTemplate(sample, ctx);

  try {
    const parsed = await callGemini({
      temperature: 0.2,
      maxTokens: 1200,
      system:
        'You turn a real message a small business sends into a REUSABLE TEMPLATE. ' +
        'Copy the message EXACTLY — same wording, punctuation, emoji, line breaks and ' +
        'language — and replace ONLY the parts that change from one send to the next ' +
        '(numbers, counts, names, dates, times, prices) with {{snake_case}} placeholders. ' +
        'Never invent, translate, reorder, or remove text. Never turn fixed wording into a ' +
        'placeholder. Name each placeholder after the label next to it in the message. ' +
        'For every placeholder return the key, a short human label, and the exact value ' +
        'that appeared in this message as the example. Respond as JSON only.',
      user:
        `Platform: ${platform || 'instagram'}\n` +
        `Business: ${businessName || 'a local business'}\n` +
        `Category: ${category || 'general'}\n\n` +
        `Message to templatize:\n"""\n${String(sample || '').slice(0, 2000)}\n"""\n\n` +
        'Return the template text plus its variables. Also return a short "name" (max 6 ' +
        'words) describing what this template is for, in the same language as the message.',
      schema: TEMPLATE_SCHEMA,
    });

    const templateText = String(parsed.templateText || '').trim();
    // No placeholders means the model failed at the one job that matters —
    // fall back rather than save a "template" that is just the raw message.
    if (!templateText || !extractVariables(templateText).length) {
      return heuristicTemplate(sample, ctx);
    }
    return {
      name: String(parsed.name || defaultName(sample, platform)).slice(0, 60),
      templateText,
      variables: reconcileVariables(templateText, parsed.variables),
      source: 'gemini',
    };
  } catch (err) {
    console.error('Gemini analyzeTemplate failed, using heuristic parser:', err.message);
    return heuristicTemplate(sample, ctx);
  }
}

const CONTENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    post: { type: 'STRING' },
    mediaTip: { type: 'STRING' },
    hashtags: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['post', 'mediaTip', 'hashtags'],
  propertyOrdering: ['post', 'mediaTip', 'hashtags'],
};

const LANG_NAMES = { en: 'English', uz: 'Uzbek (Latin script)', ru: 'Russian' };

// The caller's language ORDER is meaningful: the owner picks it in the UI and
// expects the finished post to read in exactly that sequence (a Tashkent
// business often wants Uzbek first, then Russian, then English). So the order
// is preserved verbatim and never re-sorted to put English first.
function normalizeLanguages(languages) {
  const seen = new Set();
  const langs = (Array.isArray(languages) ? languages : [])
    .map((l) => String(l).toLowerCase())
    .filter((l) => LANG_NAMES[l] && !seen.has(l) && seen.add(l));
  return langs.length ? langs : ['en'];
}

// No explicit language list (the AI Generation popup has no language picker
// anymore) means "write it back in whatever language the topic itself was
// written in" rather than silently forcing English.
function langInstructionFor(languages) {
  if (languages == null) {
    return (
      'Detect the language the "Post topic" below is written in, and write the ' +
      'ENTIRE post in that same language. If the topic is empty or its language ' +
      'is unclear, default to English.'
    );
  }
  const langs = normalizeLanguages(languages);
  if (langs.length === 1) return `Write the post in ${LANG_NAMES[langs[0]]} only.`;
  return (
    'Write ONE post that carries the same message in each of these languages, ' +
    `in exactly this order: ${langs.map((l, i) => `${i + 1}. ${LANG_NAMES[l]}`).join(', ')}. ` +
    'Separate the language blocks with a blank line so they are easy to read in a single message. ' +
    'Do not reorder the languages and do not add any language that is not listed.'
  );
}

// Keyless best-effort script/keyword sniff for the offline template fallback,
// which has no model in the loop to actually understand the topic. Cyrillic
// script is a solid signal for Russian; a handful of common Uzbek function
// words (and the oʻ/gʻ apostrophe letters) catch Uzbek written in Latin
// script. Anything else defaults to English.
function detectLanguage(text) {
  const s = String(text || '');
  if (/[Ѐ-ӿ]/.test(s)) return 'ru';
  if (/[ʻʼ‘’']/.test(s) || /\b(va|uchun|bilan|bugun|hafta|bo'lgan)\b/i.test(s)) return 'uz';
  return 'en';
}

// Social post copy. Returns null (never throws) when Gemini is unavailable or
// the call fails, so ai.generateContent can fall through to its next provider.
async function generateContent(ctx) {
  if (!config.geminiEnabled) return null;
  const { platform = 'instagram', topic, businessName, category, description, brandTone, audience, previousText, feedback } = ctx;
  const langInstruction = langInstructionFor(ctx.languages);
  // A follow-up prompt ("shorter", "add more emojis", …) revises the draft
  // already on screen instead of writing a brand-new one from the topic.
  const revising = !!(previousText && feedback);

  try {
    const parsed = await callGemini({
      maxTokens: 1500,
      system:
        "You are Markivo's expert social-media copywriter for small businesses. " +
        `${langInstruction} ${revising ? 'Revise the existing draft per the instruction — keep everything else about it intact.' : 'Write a single platform-native post that matches the brand tone.'} ` +
        'Keep hashtags OUT of the post body — return them separately. Respond as JSON only.',
      user:
        `Business: ${businessName || 'a local business'}\n` +
        `Category: ${category || 'general'}\n` +
        `Business description: ${description || 'n/a'}\n` +
        `Brand tone: ${brandTone || 'Cozy & Warm'}\n` +
        `Target audience: ${audience || 'local customers'}\n` +
        `Platform: ${platform}\n` +
        `Post topic: ${topic || 'a friendly general promotion'}\n\n` +
        (revising
          ? `Current draft:\n${previousText}\n\nRevision instruction: ${feedback}\n\nReturn the revised post, an updated one-line phone photography/video tip, and 4-6 relevant hashtags.`
          : 'Write the post, a one-line phone photography/video tip, and 4-6 relevant hashtags.'),
      schema: CONTENT_SCHEMA,
    });
    if (!parsed.post) return null;
    return {
      post: String(parsed.post),
      mediaTip: String(parsed.mediaTip || ''),
      hashtags: (parsed.hashtags || []).filter(Boolean).map(String),
    };
  } catch (err) {
    console.error('Gemini generateContent failed, falling back:', err.message);
    return null;
  }
}

// ===========================================================================
// MEDIA STUDIO — the guided shoot brief
// ===========================================================================
//
// "Guided" means the owner is holding the camera, so the brief has to contain
// what a professional photographer or videographer would actually decide before
// a shoot: how to stage the scene, what the camera is set to, and — for video —
// the scenario, the spoken script, the camera movements, and the order the
// whole thing flows in. Two schemas, because a photo shoot and a video shoot
// are not the same job.

const CAMERA_SCHEMA = {
  type: 'OBJECT',
  properties: {
    device: { type: 'STRING' },
    lens: { type: 'STRING' },
    settings: { type: 'STRING' },
    whiteBalance: { type: 'STRING' },
    stabilisation: { type: 'STRING' },
  },
  required: ['device', 'lens', 'settings', 'whiteBalance', 'stabilisation'],
  propertyOrdering: ['device', 'lens', 'settings', 'whiteBalance', 'stabilisation'],
};

const GUIDED_PHOTO_SCHEMA = {
  type: 'OBJECT',
  properties: {
    scene: { type: 'STRING' },
    setup: { type: 'ARRAY', items: { type: 'STRING' } },
    camera: CAMERA_SCHEMA,
    lighting: { type: 'STRING' },
    composition: { type: 'STRING' },
    shotList: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          framing: { type: 'STRING' },
          angle: { type: 'STRING' },
          direction: { type: 'STRING' },
        },
        required: ['name', 'framing', 'angle', 'direction'],
        propertyOrdering: ['name', 'framing', 'angle', 'direction'],
      },
    },
    postProcessing: { type: 'STRING' },
    tips: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['scene', 'setup', 'camera', 'lighting', 'composition', 'shotList', 'postProcessing', 'tips'],
  propertyOrdering: ['scene', 'setup', 'camera', 'lighting', 'composition', 'shotList', 'postProcessing', 'tips'],
};

const GUIDED_VIDEO_SCHEMA = {
  type: 'OBJECT',
  properties: {
    scenario: { type: 'STRING' },
    flow: { type: 'STRING' },
    scene: { type: 'STRING' },
    setup: { type: 'ARRAY', items: { type: 'STRING' } },
    camera: CAMERA_SCHEMA,
    lighting: { type: 'STRING' },
    composition: { type: 'STRING' },
    script: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          time: { type: 'STRING' },
          spoken: { type: 'STRING' },
          onScreenText: { type: 'STRING' },
        },
        required: ['time', 'spoken', 'onScreenText'],
        propertyOrdering: ['time', 'spoken', 'onScreenText'],
      },
    },
    shotList: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          framing: { type: 'STRING' },
          angle: { type: 'STRING' },
          movement: { type: 'STRING' },
          duration: { type: 'STRING' },
          direction: { type: 'STRING' },
        },
        required: ['name', 'framing', 'angle', 'movement', 'duration', 'direction'],
        propertyOrdering: ['name', 'framing', 'angle', 'movement', 'duration', 'direction'],
      },
    },
    bRoll: { type: 'ARRAY', items: { type: 'STRING' } },
    transitions: { type: 'ARRAY', items: { type: 'STRING' } },
    audio: { type: 'STRING' },
    postProcessing: { type: 'STRING' },
    tips: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: [
    'scenario', 'flow', 'scene', 'setup', 'camera', 'lighting', 'composition',
    'script', 'shotList', 'bRoll', 'transitions', 'audio', 'postProcessing', 'tips',
  ],
  propertyOrdering: [
    'scenario', 'flow', 'scene', 'setup', 'camera', 'lighting', 'composition',
    'script', 'shotList', 'bRoll', 'transitions', 'audio', 'postProcessing', 'tips',
  ],
};

const FULL_BRIEF_SCHEMA = {
  type: 'OBJECT',
  properties: {
    concept: { type: 'STRING' },
    caption: { type: 'STRING' },
    visualSpec: {
      type: 'OBJECT',
      properties: { composition: { type: 'STRING' }, palette: { type: 'STRING' }, mood: { type: 'STRING' } },
      required: ['composition', 'palette', 'mood'],
      propertyOrdering: ['composition', 'palette', 'mood'],
    },
  },
  required: ['concept', 'caption', 'visualSpec'],
  propertyOrdering: ['concept', 'caption', 'visualSpec'],
};

// Returns null (never throws) when Gemini is unavailable or the call fails, so
// ai.generateMediaBrief can fall through to Claude and then to its template.
async function generateMediaBrief(ctx) {
  if (!config.geminiEnabled) return null;
  const { kind = 'image', mode = 'guided', topic, profile } = ctx;
  const guided = mode === 'guided';
  const video = kind === 'video';

  const profileLines =
    `Business: ${profile?.businessName || 'a local business'}\n` +
    `Category: ${profile?.category || 'general'}\n` +
    `Business description: ${profile?.description || 'n/a'}\n` +
    `Target audience: ${profile?.targetAudience || 'local customers'}\n` +
    `Brand tone: ${profile?.brandTone || 'Cozy & Warm'}\n`;

  const guidedSystem = video
    ? 'You are a professional videographer directing a small-business owner who is filming this ' +
      'themselves. Deliver the brief a real director would hand over on the day: the scenario, how ' +
      'the finished video flows start to finish, how to stage the scene, exact camera setup, a ' +
      'timed spoken script with on-screen text, and a shot list where EVERY shot names its framing, ' +
      'angle, camera MOVEMENT, and duration. Assume a modern smartphone unless a professional ' +
      'camera would clearly be worth it — if so, say which and why. Be concrete and physical: real ' +
      'distances, real angles, real seconds. No vague advice. Respond as JSON only.'
    : 'You are a professional photographer directing a small-business owner shooting this ' +
      'themselves. Deliver the brief a real photographer would work from: how to stage and style ' +
      'the scene, exact camera setup, lighting, composition, and a shot list where EVERY shot names ' +
      'its framing, angle, and direction to the person holding the camera. Assume a modern ' +
      'smartphone unless a professional camera would clearly be worth it — if so, say which and ' +
      'why. Be concrete and physical: real distances, real angles. No vague advice. ' +
      'Respond as JSON only.';

  try {
    const parsed = await callGemini({
      maxTokens: 4000,
      temperature: guided ? 0.7 : 0.9,
      system: guided
        ? guidedSystem
        : "You are Markivo's creative director. Produce a generation-ready creative brief for an AI " +
          'media engine: a concept, a caption that includes hashtags derived from the business name ' +
          'and category, and a visual spec. Respond as JSON only.',
      user:
        profileLines +
        `Media type: ${video ? 'video' : 'photo'}\n` +
        `What they want to shoot: ${topic || 'their business'}\n\n` +
        (guided
          ? (video
            ? 'Write the full production brief: scenario, flow, scene staging, setup steps, camera, ' +
              'lighting, composition, a timed script, 5-7 shots with movement and duration, b-roll, ' +
              'transitions, audio, post-processing, and 4-6 pro tips.'
            : 'Write the full production brief: scene staging, setup steps, camera, lighting, ' +
              'composition, 5-7 shots with framing and angle, post-processing, and 4-6 pro tips.')
          : 'Write the concept, the ready-to-post caption, and the visual spec.'),
      schema: guided ? (video ? GUIDED_VIDEO_SCHEMA : GUIDED_PHOTO_SCHEMA) : FULL_BRIEF_SCHEMA,
    });

    if (guided && !(parsed.shotList || []).length) return null;
    if (!guided && !parsed.concept) return null;
    return { ...parsed, mode, kind };
  } catch (err) {
    console.error('Gemini generateMediaBrief failed, falling back:', err.message);
    return null;
  }
}

// ===========================================================================
// LOCAL-MARKET RESEARCH BRIEF
// ===========================================================================
// marketing/prompts.js has carried a complete research prompt — with a strict
// JSON contract, a ban on invented competitor names and follower counts, and a
// required groundingFlags array — that nothing ever called. prompts.js assigns
// this lane to Gemini specifically (see `division`), so there is deliberately
// no Claude leg here: research.js falls back to a deterministic template
// instead, which keeps the app working keyless.

// Gemini's responseSchema is the OpenAPI 3.0 subset: UPPERCASE type names and
// no `additionalProperties`.
const RESEARCH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    marketSnapshot: { type: 'STRING' },
    trendingAngles: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { angle: { type: 'STRING' }, why: { type: 'STRING' }, confidence: { type: 'STRING' } },
        required: ['angle', 'why', 'confidence'],
      },
    },
    seasonalHooks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { hook: { type: 'STRING' }, window: { type: 'STRING' }, idea: { type: 'STRING' } },
        required: ['hook', 'window', 'idea'],
      },
    },
    competitorPlaybook: { type: 'ARRAY', items: { type: 'STRING' } },
    contentGaps: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { gap: { type: 'STRING' }, opportunity: { type: 'STRING' } },
        required: ['gap', 'opportunity'],
      },
    },
    localNotes: { type: 'STRING' },
    groundingFlags: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['marketSnapshot', 'trendingAngles', 'seasonalHooks', 'competitorPlaybook', 'contentGaps', 'localNotes', 'groundingFlags'],
  propertyOrdering: ['marketSnapshot', 'trendingAngles', 'seasonalHooks', 'competitorPlaybook', 'contentGaps', 'localNotes', 'groundingFlags'],
};

/**
 * Grounded local-market brief, or null when keyless / on any failure — the
 * caller substitutes a deterministic template, exactly like generateContent.
 */
async function researchBrief({ name, category, location, topic } = {}) {
  if (!config.geminiEnabled) return null;
  const vars = {
    name: name || 'this business',
    category: category || 'local business',
    location: location || 'Tashkent',
    topic: topic || 'evergreen local visibility and foot traffic',
  };
  try {
    return await callGemini({
      system: fill(prompts.research.researchSystemPrompt, vars),
      user: fill(prompts.research.researchUserTemplate, vars),
      schema: RESEARCH_SCHEMA,
      maxTokens: 2200,
      // Research wants consistency over flair; the copy step supplies the flair.
      temperature: 0.4,
    });
  } catch (err) {
    console.error('Gemini researchBrief failed, falling back:', err.message);
    return null;
  }
}

module.exports = {
  enabled: config.geminiEnabled,
  model: config.geminiTextModel,
  generateContent,
  researchBrief,
  RESEARCH_SCHEMA,
  generateMediaBrief,
  analyzeTemplate,
  // Deterministic helpers — used by the routes and exercised directly by tests.
  normalizeLanguages,
  langInstructionFor,
  detectLanguage,
  heuristicTemplate,
  extractVariables,
  reconcileVariables,
  renderTemplate,
  blankPreview,
  toKey,
};
