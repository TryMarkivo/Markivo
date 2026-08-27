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

const API_HOST = 'https://generativelanguage.googleapis.com/v1beta';

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

// Convert a standard (lowercase-type) JSON schema — as used throughout ai.js
// for Anthropic's output_config — into Gemini's OpenAPI-3.0 subset: UPPERCASE
// type names, no additionalProperties, plus propertyOrdering. Recursive, so
// ai.js's schemas (and Anthropic tool input_schemas) never need a second,
// hand-maintained Gemini twin.
const TYPE_MAP = { object: 'OBJECT', array: 'ARRAY', string: 'STRING', number: 'NUMBER', integer: 'INTEGER', boolean: 'BOOLEAN' };

function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = { type: TYPE_MAP[schema.type] || schema.type };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.type === 'object' && schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)])
    );
    out.propertyOrdering = Object.keys(schema.properties);
    if (schema.required) out.required = schema.required;
  }
  if (schema.type === 'array' && schema.items) out.items = toGeminiSchema(schema.items);
  return out;
}

// Single-turn structured JSON completion using an already-lowercase (Anthropic-
// style) schema — converts it, then delegates to callGemini above.
async function callGeminiJSON({ system, prompt, schema, maxTokens, temperature } = {}) {
  return callGemini({ system, user: prompt, schema: toGeminiSchema(schema), maxTokens, temperature });
}

// Low-level tool-calling primitive for the multi-turn agent loop
// (ai.js#agentAct). Unlike callGemini, this does NOT extract text — the caller
// needs to inspect content.parts for functionCall vs text parts and drive its
// own loop, exactly like it already does against Anthropic's tool-use API.
// `tools` is the SAME Anthropic-shaped array ai.js already builds ({ name,
// description, input_schema }); converted to Gemini's functionDeclarations here
// so there is one source of truth for what tools exist.
async function callGeminiWithTools({ system, contents, tools, maxTokens = 1000, temperature } = {}) {
  if (!config.geminiEnabled) throw new Error('Gemini is not configured');

  const body = {
    contents,
    tools: [{
      functionDeclarations: (tools || []).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: toGeminiSchema(t.input_schema),
      })),
    }],
    generationConfig: { maxOutputTokens: maxTokens, ...(temperature != null ? { temperature } : {}) },
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
  return (((data.candidates || [])[0] || {}).content) || { parts: [], role: 'model' };
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

// ===========================================================================
// STYLE ANALYSIS — learn a reusable "how they write" voice profile from a
// sample post/message (the owner's own, or copied from a competitor). Unlike
// templates, this is NOT about {{variables}}: styleSummary is a plain-text
// description of the VOICE (tone, sentence rhythm, punctuation/emoji habits,
// sign-offs) that gets folded into the generation prompt later, never the
// sample's actual subject matter.
// ===========================================================================

// Broad emoji range covering the blocks actually seen in social copy
// (emoticons, symbols, transport, dingbats, supplemental symbols).
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}]/gu;

// Deterministic, never-wrong-in-a-surprising-way style read — the same
// philosophy as heuristicTemplate: measurable facts about the text, phrased
// as a style guide rather than a content summary.
function heuristicStyle(sample) {
  const text = String(sample || '').trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const words = text.match(/[\p{L}\p{N}']+/gu) || [];
  const avgSentenceLen = sentences.length ? Math.round(words.length / sentences.length) : 0;

  const emojis = text.match(EMOJI_RE) || [];
  const distinctEmojis = [...new Set(emojis)].slice(0, 6);
  const emojiDensity = words.length ? emojis.length / words.length : 0;

  const exclaimCount = (text.match(/!/g) || []).length;
  const questionCount = (text.match(/\?/g) || []).length;
  const hashtags = text.match(/#[\p{L}\p{N}_]+/gu) || [];
  const lines = text.split(/\n+/).filter((l) => l.trim());
  const capsWords = words.filter((w) => w.length >= 3 && w === w.toUpperCase() && /[A-Z]/.test(w));

  const bits = [];
  bits.push(
    avgSentenceLen <= 6
      ? `very short, punchy sentences (avg ~${avgSentenceLen} words)`
      : avgSentenceLen <= 14
        ? `short-to-medium sentences (avg ~${avgSentenceLen} words)`
        : `longer, more descriptive sentences (avg ~${avgSentenceLen} words)`
  );
  bits.push(
    distinctEmojis.length
      ? `${emojiDensity > 0.08 ? 'heavy' : 'light'} emoji use (e.g. ${distinctEmojis.join(' ')})`
      : 'no emoji'
  );
  if (exclaimCount) bits.push(`uses exclamation marks (${exclaimCount} in this sample)`);
  if (questionCount) bits.push('asks questions to engage the reader');
  if (capsWords.length) bits.push(`occasional ALL-CAPS emphasis (e.g. "${capsWords[0]}")`);
  bits.push(
    hashtags.length
      ? `uses ${hashtags.length} hashtag${hashtags.length === 1 ? '' : 's'} (e.g. ${hashtags.slice(0, 3).join(' ')})`
      : 'no hashtags'
  );
  bits.push(lines.length > 1 ? `breaks into ${lines.length} short lines rather than one paragraph` : 'writes as one continuous block, no line breaks');

  return {
    name: defaultName(text, 'Style'),
    styleSummary: `Voice: ${bits.join('; ')}.`,
    source: 'heuristic',
  };
}

const STYLE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    styleSummary: { type: 'STRING' },
  },
  required: ['name', 'styleSummary'],
  propertyOrdering: ['name', 'styleSummary'],
};

// Analyze a sample post's WRITING STYLE (not its content) and turn it into a
// reusable voice profile another draft can be written in. Keyless -> the
// deterministic heuristic above.
async function analyzeStyle(ctx) {
  const { sample, businessName, category } = ctx;
  if (!config.geminiEnabled) return heuristicStyle(sample);

  try {
    const parsed = await callGemini({
      temperature: 0.3,
      maxTokens: 700,
      system:
        'You analyze the WRITING STYLE of a sample social media post or message and produce ' +
        'a concise, reusable style guide another writer could follow to sound like the same ' +
        'voice. Describe HOW it is written, never WHAT it is about — do not repeat or ' +
        'summarize the sample\'s subject matter, product names, prices, or specific claims. ' +
        'Cover: overall tone/personality, sentence rhythm and typical length, punctuation ' +
        'habits (exclamation/question marks, ellipses), emoji usage and where it appears, ' +
        'capitalization quirks, hashtag habits, typical opening or closing lines, and ' +
        'vocabulary flavor (casual/formal/playful/technical). Write styleSummary as 3-6 tight ' +
        'sentences, in English, usable as a standing instruction to an AI copywriter. Also ' +
        'return a short "name" (max 6 words) that identifies this voice (e.g. "Playful & ' +
        'emoji-heavy", "Formal, no-emoji, data-led"). Respond as JSON only.',
      user:
        `Business: ${businessName || 'a local business'}\n` +
        `Category: ${category || 'general'}\n\n` +
        `Sample text to analyze the STYLE of (not the content):\n"""\n${String(sample || '').slice(0, 2000)}\n"""`,
      schema: STYLE_SCHEMA,
    });

    const styleSummary = String(parsed.styleSummary || '').trim();
    if (!styleSummary) return heuristicStyle(sample);
    return {
      name: String(parsed.name || defaultName(sample, 'Style')).slice(0, 60),
      styleSummary,
      source: 'gemini',
    };
  } catch (err) {
    console.error('Gemini analyzeStyle failed, using heuristic style read:', err.message);
    return heuristicStyle(sample);
  }
}

// ===========================================================================
// AI EDITOR — Translate / Fix / one-tap Style presets applied to whatever text
// is already sitting in the composer (distinct from analyzeStyle above, which
// LEARNS a reusable voice from a sample; this REWRITES given text to match an
// instruction, Telegram "AI Editor" style). Keyless: translate and the style
// transform have no honest heuristic substitute, so they hand back the
// original text unchanged with source:'unavailable' rather than throwing —
// Fix gets a real (if modest) regex cleanup, in the same spirit as
// heuristicTemplate/heuristicStyle above.
// ===========================================================================

// key/label/emoji drive the UI chip; instruction is the actual rewrite
// directive sent to Gemini and is never exposed to the client (see
// /api/styles/presets, which strips it).
const STYLE_PRESETS = [
  { key: 'formal', label: 'Formal', emoji: '🤝', instruction: 'Rewrite in a formal, professional, respectful register — no slang, no exclamation marks, complete sentences.' },
  { key: 'short', label: 'Short', emoji: '🎯', instruction: 'Condense to the essential message only, as few short sentences as possible, cut anything non-essential.' },
  { key: 'friendly', label: 'Friendly', emoji: '😊', instruction: 'Rewrite warm, casual, and approachable, like talking to a friend — relaxed contractions, welcoming tone.' },
  { key: 'persuasive', label: 'Persuasive', emoji: '📢', instruction: 'Rewrite confident and benefit-led, building urgency, ending on a clear call to action.' },
  { key: 'playful', label: 'Playful', emoji: '🎉', instruction: 'Rewrite fun, energetic, and playful — lively punctuation, upbeat rhythm.' },
  { key: 'tribal', label: 'Tribal', emoji: '🪘', instruction: 'Rewrite in a primal, communal, rhythmic oral-storytelling voice, evoking ancestral/tribal tradition — chant-like repetition, a sense of gathering and shared ritual.' },
  { key: 'biblical', label: 'Biblical', emoji: '🕯️', instruction: 'Rewrite in a solemn, poetic, King-James-Bible-style voice — "thee/thou" register, measured cadence, reverent tone.' },
  { key: 'corporate', label: 'Corporate', emoji: '🏢', instruction: 'Rewrite as a polished corporate press-release — measured, buttoned-up, on-message.' },
  { key: 'minimalist', label: 'Minimalist', emoji: '✂️', instruction: 'Strip to the bare essentials — no filler words, no emoji, no adjectives that are not load-bearing.' },
  { key: 'storyteller', label: 'Storyteller', emoji: '📖', instruction: 'Rewrite as a short, vivid narrative that draws the reader into a small scene or story before landing the point.' },
];

const EMOJIFY_SUFFIX = ' Also weave in expressive, relevant emoji throughout.';

// Translate `text` into `targetLanguage` (any human language name, not just
// the LANG_NAMES set used by generateContent — the AI Editor lets the owner
// translate into anything Gemini understands). Keyless -> text unchanged.
async function translateText({ text, targetLanguage }) {
  if (!config.geminiEnabled) return { text: String(text || ''), source: 'unavailable' };
  try {
    const out = await callGemini({
      temperature: 0.2,
      maxTokens: 1200,
      system:
        `Translate the given text into ${targetLanguage}. Preserve the meaning, tone, emoji, ` +
        'line breaks, and any hashtags/mentions exactly. Output ONLY the translated text — ' +
        'no preamble, no quotes, no explanation.',
      user: String(text || '').slice(0, 4000),
    });
    return { text: out.trim() || String(text || ''), source: 'gemini' };
  } catch (err) {
    console.error('Gemini translateText failed, returning original text:', err.message);
    return { text: String(text || ''), source: 'unavailable' };
  }
}

// Deterministic light-touch cleanup — genuinely useful without a model, same
// philosophy as heuristicTemplate: never wrong in a surprising way.
function heuristicFix(text) {
  return String(text || '')
    .trim()
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/([!?.,])\1{1,}/g, '$1')
    .replace(/(^|[.!?]\s+)([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
}

// Fix grammar/spelling/punctuation only — never change language, meaning,
// tone, or emoji. Keyless -> heuristicFix.
async function fixText({ text }) {
  if (!config.geminiEnabled) return { text: heuristicFix(text), source: 'heuristic' };
  try {
    const out = await callGemini({
      temperature: 0.2,
      maxTokens: 1200,
      system:
        'Fix ONLY grammar, spelling, and punctuation mistakes in the given text. Never change ' +
        'its language, meaning, tone, emoji, line breaks, hashtags, or mentions, and never add ' +
        'or remove sentences. Output ONLY the corrected text — no preamble, no quotes.',
      user: String(text || '').slice(0, 4000),
    });
    return { text: out.trim() || heuristicFix(text), source: 'gemini' };
  } catch (err) {
    console.error('Gemini fixText failed, using heuristic cleanup:', err.message);
    return { text: heuristicFix(text), source: 'heuristic' };
  }
}

// Rewrite `text` to match `instruction` (a built-in preset's instruction, or a
// saved style's styleSummary). Keyless -> text unchanged; a persona rewrite
// has no honest heuristic substitute.
async function applyStyleTransform({ text, instruction, emojify }) {
  if (!config.geminiEnabled) return { text: String(text || ''), source: 'unavailable' };
  try {
    const out = await callGemini({
      temperature: 0.7,
      maxTokens: 1200,
      system:
        `${instruction}${emojify ? EMOJIFY_SUFFIX : ''} Keep the same underlying message and ` +
        'language as the original — only change HOW it is written. Output ONLY the rewritten ' +
        'text — no preamble, no quotes, no explanation.',
      user: String(text || '').slice(0, 4000),
    });
    return { text: out.trim() || String(text || ''), source: 'gemini' };
  } catch (err) {
    console.error('Gemini applyStyleTransform failed, returning original text:', err.message);
    return { text: String(text || ''), source: 'unavailable' };
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
  const { platform = 'instagram', topic, businessName, category, description, brandTone, audience, previousText, feedback, styleSummary } = ctx;
  const langInstruction = langInstructionFor(ctx.languages);
  // A follow-up prompt ("shorter", "add more emojis", …) revises the draft
  // already on screen instead of writing a brand-new one from the topic.
  const revising = !!(previousText && feedback);
  // A selected saved Style (see content_styles / gemini.js#analyzeStyle) steers
  // HOW the post is written; it must never leak the sample post's own content.
  const styleInstruction = styleSummary
    ? ` WRITING STYLE TO MATCH: ${styleSummary} Write in this voice — its tone, sentence rhythm, and emoji/punctuation habits — but never copy any subject matter from wherever that style was learned; the topic below is the only source of what to write about.`
    : '';

  try {
    const parsed = await callGemini({
      maxTokens: 1500,
      system:
        "You are Markivo's expert social-media copywriter for small businesses. " +
        `${langInstruction} ${revising ? 'Revise the existing draft per the instruction — keep everything else about it intact.' : 'Write a single platform-native post that matches the brand tone.'}` +
        `${styleInstruction} ` +
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
// BUSINESS CONTEXT — the per-business memory cell
// ===========================================================================
//
// Gemini's API is stateless per call, so there is no such thing as a Gemini-side
// memory for a business. "Memory" here means: distil the owner's profile ONCE at
// creation time, store that distillation ourselves keyed by business id (see
// businessContextService.js), and re-inject it into every later prompt for that
// business. This function is only the distillation step.

const BUSINESS_CONTEXT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    tone: { type: 'STRING' },
    audience: { type: 'STRING' },
    sellingPoints: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['summary', 'tone', 'audience', 'sellingPoints'],
  propertyOrdering: ['summary', 'tone', 'audience', 'sellingPoints'],
};

async function generateBusinessContext(profileData) {
  if (!config.geminiEnabled) return null;
  const { businessName, category, description, tone, audience, location } = profileData || {};

  try {
    const parsed = await callGemini({
      // Low temperature: this is a distillation of what the owner already told
      // us, not a creative act. Everything downstream reads from it, so drift
      // here would compound across every generator.
      temperature: 0.3,
      maxTokens: 800,
      system:
        'You distil a small business into a compact working context that other ' +
        'AI writers will rely on. Summarise ONLY what the owner actually told ' +
        'you — never invent prices, hours, awards, locations, or numbers. If a ' +
        'detail is missing, leave it out rather than guessing. Write the summary ' +
        'as 2-3 plain sentences, the tone as a short phrase, the audience as one ' +
        'sentence, and 3-5 concrete selling points. Respond as JSON only.',
      user:
        `Business name: ${businessName || 'a local business'}\n` +
        `Category: ${category || 'general'}\n` +
        `What the business does (owner's own words): ${description || 'n/a'}\n` +
        `Stated tone/voice preference: ${tone || 'not specified'}\n` +
        `Stated target audience: ${audience || 'not specified'}\n` +
        `Location: ${location || 'not specified'}\n\n` +
        'Produce the working context.',
      schema: BUSINESS_CONTEXT_SCHEMA,
    });
    // A context with no summary is unusable downstream — treat it as a miss so
    // the caller stores its deterministic template cell instead.
    if (!parsed.summary) return null;
    return {
      summary: String(parsed.summary),
      tone: String(parsed.tone || ''),
      audience: String(parsed.audience || ''),
      sellingPoints: (parsed.sellingPoints || []).filter(Boolean).map(String).slice(0, 6),
    };
  } catch (err) {
    console.error('Gemini generateBusinessContext failed, falling back:', err.message);
    return null;
  }
}

// ===========================================================================
// SLOGANS — grounded in the stored business context, not tone templates
// ===========================================================================

const SLOGAN_SCHEMA = {
  type: 'OBJECT',
  properties: { slogans: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['slogans'],
  propertyOrdering: ['slogans'],
};

// `digest` is businessContextService.contextDigest(...) — the ONLY business
// input. Passing the digest rather than raw profile columns is what keeps one
// business's context from leaking into another's slogans.
async function generateSlogans({ digest, businessName }) {
  if (!config.geminiEnabled) return null;
  if (!digest) return null; // no stored context yet — let the caller fall through

  try {
    const parsed = await callGemini({
      maxTokens: 400,
      temperature: 0.9,
      system:
        'You are a brand strategist. Generate exactly 3 short, memorable, ' +
        'original brand slogans (max 6 words each) grounded in the business ' +
        'context below. They must be specific to THIS business — reject anything ' +
        'that would read the same for any company in the category. Never invent ' +
        'prices, hours, or numbers. Respond as JSON only.',
      user: `${digest}\n\nBusiness name: ${businessName || 'this business'}\n\nWrite the 3 slogans.`,
      schema: SLOGAN_SCHEMA,
    });
    const slogans = (parsed.slogans || []).filter(Boolean).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 3);
    if (slogans.length !== 3) return null;
    return slogans;
  } catch (err) {
    console.error('Gemini generateSlogans failed, falling back:', err.message);
    return null;
  }
}

// ===========================================================================
// AUTOPILOT CONTEXT ASSESSMENT — "do we know enough to post right now?"
// ===========================================================================
//
// This judges CONTEXT, not writing. It runs before Autopilot spends a
// generation, so that a business we know nothing about gets a question rather
// than a generic ad. See autopilotContext.js for the surrounding gate.

const AD_CONTEXT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    sufficient: { type: 'BOOLEAN' },
    adType: { type: 'STRING' },
    rationale: { type: 'STRING' },
    questions: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['sufficient', 'adType', 'rationale', 'questions'],
  propertyOrdering: ['sufficient', 'adType', 'rationale', 'questions'],
};

const listOr = (arr, empty) => (Array.isArray(arr) && arr.length ? arr.join(', ') : empty);

async function assessAdContext(signals) {
  if (!config.geminiEnabled) return null;
  const s = signals || {};
  const profile = s.profile || {};
  const bc = s.businessContext;

  try {
    const parsed = await callGemini({
      // Near-deterministic: this is a judgement call that gates real publishing.
      temperature: 0.2,
      maxTokens: 800,
      system:
        "You decide whether Markivo's Autopilot knows enough about this business " +
        'and its connected channel to write a promotional post that is right for ' +
        'THIS moment — not a generic ad. Judge the CONTEXT, not the writing. Set ' +
        'sufficient=true only when you can name a concrete adType that follows ' +
        'from the evidence below (e.g. "weekday-morning offer for remote workers", ' +
        '"new seasonal menu announcement"). If you cannot, set sufficient=false ' +
        'and ask AT MOST 3 short, plain-language questions the owner can each ' +
        'answer in one line — covering what kind of post they want right now, the ' +
        'campaign goal, and the target action (visit / call / order / book / ' +
        'follow). Never ask for anything already stated below. Respond as JSON only.',
      user:
        `Business: ${profile.businessName || 'unknown'}\n` +
        `Category: ${profile.category || 'unknown'}\n` +
        `Description: ${profile.description || 'none given'}\n` +
        `Brand tone: ${profile.brandTone || 'unspecified'}\n` +
        `Location: ${profile.location || 'unspecified'}\n\n` +
        'STORED BUSINESS CONTEXT:\n' +
        (bc
          ? `${bc.summary || ''}\nTone: ${bc.tone || 'n/a'}\nAudience: ${bc.audience || 'n/a'}\n` +
            `Selling points: ${listOr(bc.sellingPoints, 'none recorded')}\n`
          : 'none stored yet\n') +
        '\nOWNER-SUPPLIED CONTEXT (their answer to an earlier question):\n' +
        `${(s.userContext && s.userContext.answer) || 'none given'}\n` +
        `\nCONNECTED CHANNELS: ${listOr(s.connectedPlatforms, 'none connected')}\n` +
        `Telegram linked: ${s.telegram && s.telegram.linked ? 'yes' : 'no'}\n` +
        `Instagram linked: ${s.instagram && s.instagram.linked ? 'yes' : 'no'}\n` +
        `\nLAST ${(s.recentPosts || []).length} POSTS:\n${listOr((s.recentPosts || []).map((p) => `- ${String(p).slice(0, 200)}`), '(nothing posted yet)')}\n` +
        `\nTRACKED COMPETITORS: ${listOr(s.competitors, 'none tracked')}\n` +
        `TARGET PLATFORMS FOR THIS RUN: ${listOr(s.targetPlatforms, 'none resolved')}\n\n` +
        'Assess whether there is enough context to post right now.',
      schema: AD_CONTEXT_SCHEMA,
    });

    const questions = (parsed.questions || []).filter(Boolean).map(String).map((q) => q.slice(0, 200)).slice(0, 3);
    // "Not sufficient" with nothing to ask is an unusable verdict — it would
    // pause Autopilot with no way for the owner to unblock it. Treat as a miss.
    if (parsed.sufficient !== true && !questions.length) return null;
    return {
      sufficient: parsed.sufficient === true,
      adType: String(parsed.adType || '').slice(0, 120),
      rationale: String(parsed.rationale || '').slice(0, 500),
      questions,
      source: 'gemini',
    };
  } catch (err) {
    console.error('Gemini assessAdContext failed, falling back:', err.message);
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
  const { kind = 'image', mode = 'guided', topic, profile, trends } = ctx;
  const guided = mode === 'guided';
  const video = kind === 'video';

  const profileLines =
    `Business: ${profile?.businessName || 'a local business'}\n` +
    `Category: ${profile?.category || 'general'}\n` +
    `Business description: ${profile?.description || 'n/a'}\n` +
    `Target audience: ${profile?.targetAudience || 'local customers'}\n` +
    `Brand tone: ${profile?.brandTone || 'Cozy & Warm'}\n` +
    (trends
      ? `\nCOMPETITOR TREND CONTEXT (real data from tracked competitors — let it inform the concept/shot ` +
        `choices, do not quote it back verbatim):\n${String(trends).slice(0, 600)}\n`
      : '');

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

module.exports = {
  enabled: config.geminiEnabled,
  model: config.geminiTextModel,
  generateContent,
  generateMediaBrief,
  analyzeTemplate,
  analyzeStyle,
  heuristicStyle,
  // AI Editor — translate / fix / one-tap style transform on existing text.
  STYLE_PRESETS,
  translateText,
  fixText,
  heuristicFix,
  applyStyleTransform,
  // Low-level primitives shared by providers/textEngine.js and ai.js#agentAct.
  toGeminiSchema,
  callGeminiJSON,
  callGeminiWithTools,
  generateBusinessContext,
  generateSlogans,
  assessAdContext,
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
  LANG_NAMES,
};
