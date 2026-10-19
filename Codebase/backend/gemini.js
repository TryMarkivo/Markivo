// Google Gemini — Markivo's reasoning engine (Gemini 4 Argon by default).
//
// Every text request in the app lands here: post copy, message templates,
// slogans, business context, Autopilot's gate, media briefs, Markiv's tool
// loop, and the art direction that writes image/video render prompts.
//
// Talks to the Interactions API directly with global fetch (same approach as
// mediagen.js / places.js) so no extra SDK dependency is pulled in:
//   POST https://generativelanguage.googleapis.com/v1beta/interactions
// Argon is served through this API only; it is not on generateContent.
// Docs: https://ai.google.dev/api/interactions-api
//
// Markivo rule: a BLANK credential must never break the app or the tests. With
// no GEMINI_API_KEY every export falls back to a deterministic result — copy
// falls back to the ai.js templates (via the caller), and template extraction
// falls back to the heuristic parser below, which is genuinely useful on its
// own (it finds the numbers in "Stadium No:141, 9 spots left" without any AI).

const config = require('./config');
const prompts = require('./marketing/prompts');
const i18n = require('./i18n');

const API_HOST = 'https://generativelanguage.googleapis.com/v1beta';

// ${placeholder} interpolation for the authored prompt templates.
const fill = (tmpl, vars) =>
  String(tmpl).replace(/\$\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));

// ===========================================================================
// LOW-LEVEL CLIENT
// ===========================================================================

// max_output_tokens is a hard cap on thinking AND answer together. The callers'
// budgets were sized for the answer alone, so without this headroom a model
// that reasons first truncates its JSON mid-object. Unused headroom costs
// nothing — only generated tokens are billed.
const THINKING_HEADROOM_TOKENS = 8192;

class GeminiError extends Error {
  constructor(message, { status, retryable } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    // True when a different model could plausibly answer: the request reached
    // Google and was refused (tier, access, quota), as opposed to a timeout or
    // a dropped connection, where a second attempt would only double the wait.
    this.retryable = !!retryable;
  }
}

async function postInteraction(body) {
  let res;
  try {
    res = await fetch(`${API_HOST}/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.geminiTimeoutMs),
    });
  } catch (err) {
    throw new GeminiError(`Gemini (${body.model}) unreachable: ${err.message}`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || `HTTP ${res.status}`;
    throw new GeminiError(`Gemini (${body.model}) request failed: ${msg}`, { status: res.status, retryable: true });
  }
  if (data.status === 'failed' || data.status === 'cancelled') {
    const msg = ((data.errors || [])[0] || {}).message || `interaction ${data.status}`;
    throw new GeminiError(`Gemini (${body.model}) ${msg}`, { retryable: true });
  }
  return data;
}

/**
 * One stateless interaction on the configured model, retried once on the
 * fallback model when the primary refuses it. `store: false` keeps owners'
 * business details out of Google's interaction history — the conversation
 * state lives in our own database, so we never need it there.
 */
async function createInteraction({ system, input, schema, tools, maxTokens = 1500 }) {
  if (!config.geminiEnabled) throw new Error('Gemini is not configured');

  const body = {
    input,
    store: false,
    generation_config: {
      max_output_tokens: maxTokens + THINKING_HEADROOM_TOKENS,
      thinking_level: config.geminiThinkingLevel,
    },
  };
  if (system) body.system_instruction = system;
  if (schema) body.response_format = { type: 'text', mime_type: 'application/json', schema: toJsonSchema(schema) };
  if (tools && tools.length) {
    body.tools = tools.map((t) => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: toJsonSchema(t.input_schema),
    }));
  }

  try {
    return await postInteraction({ model: config.geminiTextModel, ...body });
  } catch (err) {
    const fallback = config.geminiFallbackModel;
    if (!err.retryable || !fallback || fallback === config.geminiTextModel) throw err;
    console.warn(`${err.message} — retrying on ${fallback}`);
    return postInteraction({ model: fallback, ...body });
  }
}

// The answer text of an interaction: every text block of every model_output
// step, in order. Thought summaries and tool steps are not part of it.
const outputText = (interaction) =>
  (interaction.steps || [])
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text || '')
    .join('')
    .trim();

// Single-turn completion: parsed JSON when a schema is given, else plain text.
async function callGemini({ system, user, schema, maxTokens = 1500 }) {
  const interaction = await createInteraction({ system, input: user || '', schema, maxTokens });
  const text = outputText(interaction);
  if (!text) throw new Error('Gemini returned an empty response');
  return schema ? JSON.parse(text) : text;
}

// Normalise either schema dialect in this codebase — lowercase JSON Schema
// (ai.js, Anthropic tool input_schemas) or the UPPERCASE OpenAPI subset the
// constants below were first written in — into the plain JSON Schema the
// Interactions API takes. Keeps only the keywords structured output honours;
// propertyOrdering is dropped because key order in `properties` now carries it.
function toJsonSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const type = String(schema.type || '').toLowerCase();
  const out = { type };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (type === 'object') {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties || {}).map(([k, v]) => [k, toJsonSchema(v)])
    );
    if (schema.required) out.required = schema.required;
  }
  if (type === 'array' && schema.items) out.items = toJsonSchema(schema.items);
  return out;
}

// Single-turn structured JSON completion — the entry point providers/
// textEngine.js uses for every ai.js generator.
async function callGeminiJSON({ system, prompt, schema, maxTokens } = {}) {
  return callGemini({ system, user: prompt, schema, maxTokens });
}

// Low-level tool-calling primitive for the multi-turn agent loop
// (ai.js#agentAct). Returns the model's raw steps rather than text: the caller
// inspects them for function_call vs model_output and drives its own loop, and
// must echo them back verbatim on the next turn — they carry the thought
// signatures the API validates. `tools` is the SAME Anthropic-shaped array
// ai.js already builds ({ name, description, input_schema }), converted to
// function tools in createInteraction so there is one source of truth.
async function callGeminiWithTools({ system, input, tools, maxTokens = 1000 } = {}) {
  const interaction = await createInteraction({ system, input, tools, maxTokens });
  return { steps: interaction.steps || [], status: interaction.status };
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
// `lang` is the owner's UI language — the summary is shown to them to review.
function heuristicStyle(sample, lang = 'en') {
  const tr = (text, params) => i18n.tr(lang, text, params);
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
      ? tr('very short, punchy sentences (avg ~{{n}} words)', { n: avgSentenceLen })
      : avgSentenceLen <= 14
        ? tr('short-to-medium sentences (avg ~{{n}} words)', { n: avgSentenceLen })
        : tr('longer, more descriptive sentences (avg ~{{n}} words)', { n: avgSentenceLen })
  );
  bits.push(
    distinctEmojis.length
      ? tr(emojiDensity > 0.08 ? 'heavy emoji use (e.g. {{examples}})' : 'light emoji use (e.g. {{examples}})', { examples: distinctEmojis.join(' ') })
      : tr('no emoji')
  );
  if (exclaimCount) bits.push(tr('uses exclamation marks ({{count}} in this sample)', { count: exclaimCount }));
  if (questionCount) bits.push(tr('asks questions to engage the reader'));
  if (capsWords.length) bits.push(tr('occasional ALL-CAPS emphasis (e.g. "{{word}}")', { word: capsWords[0] }));
  bits.push(
    hashtags.length
      ? tr(hashtags.length === 1 ? 'uses {{count}} hashtag (e.g. {{examples}})' : 'uses {{count}} hashtags (e.g. {{examples}})', { count: hashtags.length, examples: hashtags.slice(0, 3).join(' ') })
      : tr('no hashtags')
  );
  bits.push(lines.length > 1
    ? tr('breaks into {{count}} short lines rather than one paragraph', { count: lines.length })
    : tr('writes as one continuous block, no line breaks'));

  return {
    name: defaultName(text, 'Style'),
    styleSummary: tr('Voice: {{traits}}.', { traits: bits.join('; ') }),
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
  const { sample, businessName, category, lang } = ctx;
  if (!config.geminiEnabled) return heuristicStyle(sample, lang);

  try {
    const parsed = await callGemini({
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
        'emoji-heavy", "Formal, no-emoji, data-led"). Respond as JSON only.' +
        // The owner reviews and edits the guide; an Uzbek or Russian guide
        // instructs the copywriter just as well.
        ownerLangRule(lang, 'the "name" and the "styleSummary"'),
      user:
        `Business: ${businessName || 'a local business'}\n` +
        `Category: ${category || 'general'}\n\n` +
        `Sample text to analyze the STYLE of (not the content):\n"""\n${String(sample || '').slice(0, 2000)}\n"""`,
      schema: STYLE_SCHEMA,
    });

    const styleSummary = String(parsed.styleSummary || '').trim();
    if (!styleSummary) return heuristicStyle(sample, lang);
    return {
      name: String(parsed.name || defaultName(sample, 'Style')).slice(0, 60),
      styleSummary,
      source: 'gemini',
    };
  } catch (err) {
    console.error('Gemini analyzeStyle failed, using heuristic style read:', err.message);
    return heuristicStyle(sample, lang);
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

/**
 * The language rule for a media brief, which is a mixed-audience document: the
 * caption, the spoken script and the on-screen lines are read by CUSTOMERS,
 * while the staging, camera and shot directions are read by the OWNER. Only
 * the first group follows the audience languages; translating a director's
 * instructions would help nobody.
 *
 * The owner's directions are written in the owner's UI language (`ownerLang`),
 * English by default. The render prompt is never translated: it is read by the
 * image/video model, which follows English best.
 *
 * Empty for an English owner who has not answered the audience question, which
 * leaves the brief exactly as it was before.
 */
function mediaLangRule(languages, ownerLang) {
  const owner = ownerLang && ownerLang !== 'en' ? LANG_NAMES[ownerLang] : null;
  const ownerLine = owner
    ? `Your directions TO THE OWNER (concept, visual spec, staging, setup, camera, lighting, ` +
      `composition, shot list, editing, tips) are written in ${owner} — the owner reads the app in ` +
      'it. The renderPrompt stays in English. '
    : 'Your directions TO THE OWNER (staging, setup, camera, lighting, composition, shot list, ' +
      'editing) stay in English — they are instructions, not content. ';
  if (!Array.isArray(languages) || !languages.length) {
    return owner
      ? `\n\nOWNER LANGUAGE: ${ownerLine}Write what a CUSTOMER will read or hear (caption, headline, ` +
        "spoken script, on-screen text) in the language of the owner's own request."
      : '';
  }
  const langs = normalizeLanguages(languages);
  const names = langs.map((l) => LANG_NAMES[l]).join(', then ');
  return (
    '\n\nAUDIENCE LANGUAGE: every word a CUSTOMER will read or hear — the caption, the spoken ' +
    `script, and any on-screen text — must be written in ${names}` +
    `${langs.length > 1 ? ', in exactly that order' : ''}. ` +
    ownerLine + 'Do not add a language that is not listed.'
  );
}

/**
 * The language for text only the OWNER reads — analysis, plans, questions,
 * explanations. It is their UI language, which can differ from their
 * customers', so it never governs post copy or anything a model renders.
 * Empty for English, the language every prompt is already written in.
 */
function ownerLangRule(lang, what) {
  if (!lang || lang === 'en' || !LANG_NAMES[lang]) return '';
  return `\n\nOWNER LANGUAGE: the business owner reads this app in ${LANG_NAMES[lang]}. ` +
    `Write ${what} in ${LANG_NAMES[lang]}, whatever the instructions above say about English. ` +
    'Keep proper names, brand names and @handles as they are.';
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
  const {
    platform = 'instagram', topic, businessName, category, description, brandTone, audience,
    previousText, feedback, styleSummary, memory, platformRules, avoid,
  } = ctx;
  const langInstruction = langInstructionFor(ctx.languages);
  // A follow-up prompt ("shorter", "add more emojis", …) revises the draft
  // already on screen instead of writing a brand-new one from the topic.
  const revising = !!(previousText && feedback);
  // A selected saved Style (see content_styles / gemini.js#analyzeStyle) steers
  // HOW the post is written; it must never leak the sample post's own content.
  const styleInstruction = styleSummary
    ? ` WRITING STYLE TO MATCH: ${styleSummary} Write in this voice — its tone, sentence rhythm, and emoji/punctuation habits — but never copy any subject matter from wherever that style was learned; the topic below is the only source of what to write about.`
    : '';
  // The business memory (businessContextService.memoryDigest) is everything
  // known about THIS business; the bare profile fields are only the fallback
  // for a caller that has none.
  const business = memory ||
    `Business: ${businessName || 'a local business'}\n` +
    `Category: ${category || 'general'}\n` +
    `Business description: ${description || 'n/a'}\n` +
    `Brand tone: ${brandTone || 'Cozy & Warm'}\n` +
    `Target audience: ${audience || 'local customers'}`;

  try {
    const parsed = await callGemini({
      maxTokens: 1500,
      system:
        'You are a senior social-media copywriter writing for ONE specific small business. Everything ' +
        'known about it is in the BUSINESS MEMORY — build the post from its concrete details (the real ' +
        'products, offer, place, facts and voice) so it could only belong to this business, and never ' +
        'invent a price, hour, number or claim that is not there. Write like a professional: a first ' +
        'line that earns the second (never a greeting or the business name), one clear message, ' +
        'specifics instead of adjectives, and exactly one call to action that fits the platform. ' +
        (platformRules ? 'Follow the PLATFORM RULES. ' : '') +
        (Array.isArray(avoid) && avoid.length ? `Never use these clichés: ${avoid.slice(0, 40).map((c) => `"${c}"`).join(', ')}. ` : '') +
        `${langInstruction} ${revising ? 'Revise the existing draft per the instruction — keep everything else about it intact.' : 'Write a single platform-native post that matches the brand voice.'}` +
        `${styleInstruction} ` +
        'Keep hashtags OUT of the post body — return them separately. Respond as JSON only.',
      user:
        `BUSINESS MEMORY:\n${business}\n\n` +
        `Platform: ${platform}\n` +
        (platformRules ? `PLATFORM RULES: ${platformRules}\n` : '') +
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
  const { businessName, category, description, tone, audience, location, details } = profileData || {};

  try {
    const parsed = await callGemini({
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
        `Location: ${location || 'not specified'}\n` +
        // Everything the owner added after signup — answered questions, facts
        // Markiv saved from chat. Newer than the fields above, so it wins.
        (details ? `\nDetails the owner has told us since signup (newest truth — fold them in):\n${details}\n` : '') +
        '\nProduce the working context.',
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
async function generateSlogans({ digest, businessName, lang }) {
  if (!config.geminiEnabled) return null;
  if (!digest) return null; // no stored context yet — let the caller fall through

  try {
    const parsed = await callGemini({
      maxTokens: 400,
      system:
        'You are a brand strategist. Generate exactly 3 short, memorable, ' +
        'original brand slogans (max 6 words each) grounded in the business ' +
        'context below. They must be specific to THIS business — reject anything ' +
        'that would read the same for any company in the category. Never invent ' +
        'prices, hours, or numbers. Respond as JSON only.' +
        // A slogan is customer-facing, but it is picked during onboarding,
        // before any audience language is known — the owner's language is
        // the best guess at their customers'.
        ownerLangRule(lang, 'the slogans'),
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
        'follow). Never ask for anything already stated below. Respond as JSON only.' +
        ownerLangRule(s.lang, 'the "rationale" and the "questions"'),
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

// Full mode is a finished ad, not a shooting plan, so the brief carries the
// words that go ON the ad (headline) and the exact prompt the render engine
// receives (renderPrompt). renderPrompt is last so the model writes it with
// the concept, copy and visual spec already decided.
const FULL_BRIEF_SCHEMA = {
  type: 'OBJECT',
  properties: {
    concept: { type: 'STRING' },
    headline: { type: 'STRING' },
    caption: { type: 'STRING' },
    visualSpec: {
      type: 'OBJECT',
      properties: { composition: { type: 'STRING' }, palette: { type: 'STRING' }, mood: { type: 'STRING' } },
      required: ['composition', 'palette', 'mood'],
      propertyOrdering: ['composition', 'palette', 'mood'],
    },
    renderPrompt: { type: 'STRING' },
  },
  required: ['concept', 'headline', 'caption', 'visualSpec', 'renderPrompt'],
  propertyOrdering: ['concept', 'headline', 'caption', 'visualSpec', 'renderPrompt'],
};

// The art-direction rules for a full-mode ad. The owner's prompt is treated as
// the brief itself: an ad that drifts from what they typed is the failure this
// exists to prevent.
function fullAdSystem(video) {
  const render = video
    ? `"renderPrompt" is the complete English prompt for a text-to-video model (Veo) that renders a ` +
      `${config.veoDurationSeconds}-second vertical 9:16 ad clip with sound. Describe the subject, what ` +
      'happens across the clip, the visual style, camera position and movement, lighting and ambiance, ' +
      'and the audio: ambient sound, sound effects, and at most one short spoken line, in quotes, in its ' +
      'final language. Do not rely on on-screen text — video models misspell it; the caption carries the words.'
    : '"renderPrompt" is the complete English prompt for an image model that renders the finished ad in ' +
      'one pass. Describe concretely: the hero subject, the setting, camera angle and framing, lighting, ' +
      'colour palette, and the ad layout — where the headline sits, its typography, and any short call to ' +
      'action. Quote every word that must appear in the image exactly, in its final language, and keep ' +
      'on-image text to the headline plus at most one short CTA line.';
  return (
    "You are Markivo's ad creative director. The owner's prompt IS the brief: every product, offer, " +
    'subject, setting, style and line of text they name must be in the ad, and nothing they did not ask ' +
    'for may replace it. Turn it into ONE finished social-media advertisement for THIS business. ' +
    '"concept" says in 1-2 sentences what the ad shows and why it sells. "headline" is the short line ' +
    '(max 7 words) the ad itself carries. "caption" is the ready-to-post caption with hashtags derived ' +
    'from the business name and category. ' + render + ' Use only prices, numbers, dates and contact ' +
    'details stated in the owner\'s prompt or the brand facts — never invent them. No other brands\' ' +
    'logos, no watermarks. If no audience language is set below, write every customer-facing word in ' +
    "the language of the owner's prompt. Respond as JSON only."
  );
}

// Returns null (never throws) when Gemini is unavailable or the call fails, so
// ai.generateMediaBrief can fall through to Claude and then to its template.
async function generateMediaBrief(ctx) {
  if (!config.geminiEnabled) return null;
  const { kind = 'image', mode = 'guided', topic, profile, trends, brandDigest } = ctx;
  const guided = mode === 'guided';
  const video = kind === 'video';
  const langRule = mediaLangRule(ctx.languages, ctx.lang);

  const profileLines =
    `Business: ${profile?.businessName || 'a local business'}\n` +
    `Category: ${profile?.category || 'general'}\n` +
    `Business description: ${profile?.description || 'n/a'}\n` +
    `Target audience: ${profile?.targetAudience || 'local customers'}\n` +
    `Brand tone: ${profile?.brandTone || 'Cozy & Warm'}\n` +
    (brandDigest
      ? `\nBUSINESS MEMORY (match its voice and visuals; its FACTS are the only real numbers):\n${brandDigest}\n`
      : '') +
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
      system: (guided ? guidedSystem : fullAdSystem(video)) + langRule,
      user:
        profileLines +
        `Media type: ${video ? 'video' : 'photo'}\n` +
        (guided
          ? `What they want to shoot: ${topic || 'their business'}\n\n` +
            (video
              ? 'Write the full production brief: scenario, flow, scene staging, setup steps, camera, ' +
                'lighting, composition, a timed script, 5-7 shots with movement and duration, b-roll, ' +
                'transitions, audio, post-processing, and 4-6 pro tips.'
              : 'Write the full production brief: scene staging, setup steps, camera, lighting, ' +
                'composition, 5-7 shots with framing and angle, post-processing, and 4-6 pro tips.')
          : `OWNER'S PROMPT (the brief — follow it exactly):\n"""\n${topic || 'an ad for their business'}\n"""\n\n` +
            `Write the concept, headline, caption, visual spec, and the ${video ? 'video' : 'image'} render prompt.`),
      schema: guided ? (video ? GUIDED_VIDEO_SCHEMA : GUIDED_PHOTO_SCHEMA) : FULL_BRIEF_SCHEMA,
    });

    if (guided && !(parsed.shotList || []).length) return null;
    if (!guided && !(parsed.concept && parsed.renderPrompt)) return null;
    return { ...parsed, mode, kind };
  } catch (err) {
    console.error('Gemini generateMediaBrief failed, falling back:', err.message);
    return null;
  }
}

// Image edits get the same art direction as renders: the owner's one-line
// request becomes a precise instruction for the image model, which receives it
// alongside the original image. Null when keyless or on failure, so the caller
// sends the owner's own words through unchanged.
async function directImageEdit({ instructions, topic, profile, memory } = {}) {
  if (!config.geminiEnabled) return null;
  try {
    const text = await callGemini({
      maxTokens: 600,
      system:
        'You write instructions for an image-EDITING model that receives the original image alongside ' +
        "your text. Rewrite the owner's request as one precise edit instruction in English: say exactly " +
        'what changes, and that everything else — subject, identity, framing, product, existing text — ' +
        'stays as it is. Keep anything you add on-brand for the business below. Quote any words that ' +
        'must appear in the image exactly, in their final language. Never add prices, numbers or claims ' +
        'the owner did not ask for. Reply with the instruction only.',
      user:
        (memory ? `BUSINESS MEMORY:\n${memory}\n\n` : '') +
        `Business: ${profile?.businessName || 'a local business'}\n` +
        `Category: ${profile?.category || 'general'}\n` +
        `What the image shows: ${topic || 'n/a'}\n` +
        `Owner's edit request: ${instructions}`,
    });
    return text ? text.slice(0, 2000) : null;
  } catch (err) {
    console.error('Gemini directImageEdit failed, using the raw request:', err.message);
    return null;
  }
}

const QUESTIONS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          key: { type: 'STRING' },
          label: { type: 'STRING' },
          hint: { type: 'STRING' },
          placeholder: { type: 'STRING' },
          type: { type: 'STRING', enum: ['text', 'textarea'] },
        },
        required: ['key', 'label', 'hint', 'placeholder', 'type'],
        propertyOrdering: ['key', 'label', 'hint', 'placeholder', 'type'],
      },
    },
  },
  required: ['questions'],
  propertyOrdering: ['questions'],
};

/**
 * 2-5 follow-up questions tailored to one business, or null when keyless / on
 * any failure — profileQuestions.js then substitutes its deterministic set.
 * The caller still sanitizes the result: a live model can return duplicate
 * keys, re-ask a known field, or overshoot the count.
 */
async function businessQuestions({ name, category, location, description, audience, fixedLabels, lang } = {}) {
  if (!config.geminiEnabled) return null;
  const vars = {
    name: name || 'this business',
    category: category || 'local business',
    location: location || 'Tashkent',
    description: description || '(not provided)',
    audience: audience || '(not provided)',
    fixedLabels: fixedLabels || '(none)',
  };
  try {
    const out = await callGemini({
      system: fill(prompts.profileQuestions.systemPrompt, vars) +
        ownerLangRule(lang, 'each question\'s "label", "hint" and "placeholder" (the "key" stays English snake_case)'),
      user: fill(prompts.profileQuestions.userTemplate, vars),
      schema: QUESTIONS_SCHEMA,
      maxTokens: 1200,
    });
    return out && Array.isArray(out.questions) ? out.questions : null;
  } catch (err) {
    console.error('Gemini businessQuestions failed, falling back:', err.message);
    return null;
  }
}

/**
 * The owner's cached follow-up questions, reworded into `lang`. Keys, types and
 * order never change — answers are stored by key — only the words the owner
 * reads. Null when Gemini is unavailable or the answer does not line up.
 */
async function translateQuestions({ questions, lang } = {}) {
  if (!config.geminiEnabled || !LANG_NAMES[lang] || !Array.isArray(questions) || !questions.length) return null;
  try {
    const out = await callGemini({
      system:
        `You translate the follow-up questions a marketing app asks a small-business owner into ${LANG_NAMES[lang]}. ` +
        'Keep every "key" exactly as given. Translate "label", "hint" and "placeholder" the way a native ' +
        'speaker would ask them — warm, direct and short. Keep names, numbers and brand names as they are. ' +
        'Respond as JSON only.',
      user: JSON.stringify({
        questions: questions.map(({ key, label, hint, placeholder }) => ({ key, label, hint, placeholder })),
      }),
      schema: QUESTIONS_SCHEMA,
      maxTokens: 1200,
    });
    const byKey = new Map(((out && out.questions) || []).map((q) => [q.key, q]));
    if (!questions.every((q) => byKey.get(q.key) && byKey.get(q.key).label)) return null;
    return questions.map((q) => {
      const t = byKey.get(q.key);
      return {
        ...q,
        label: String(t.label).trim().slice(0, 120),
        hint: String(t.hint || '').trim().slice(0, 160),
        placeholder: String(t.placeholder || '').trim().slice(0, 80),
        lang,
      };
    });
  } catch (err) {
    console.error('Gemini translateQuestions failed:', err.message);
    return null;
  }
}

module.exports = {
  enabled: config.geminiEnabled,
  model: config.geminiTextModel,
  generateContent,
  businessQuestions,
  translateQuestions,
  QUESTIONS_SCHEMA,
  generateMediaBrief,
  fullAdSystem,
  directImageEdit,
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
  toJsonSchema,
  outputText,
  callGeminiJSON,
  callGeminiWithTools,
  generateBusinessContext,
  generateSlogans,
  assessAdContext,
  // Deterministic helpers — used by the routes and exercised directly by tests.
  normalizeLanguages,
  langInstructionFor,
  mediaLangRule,
  detectLanguage,
  heuristicTemplate,
  extractVariables,
  reconcileVariables,
  renderTemplate,
  blankPreview,
  toKey,
  LANG_NAMES,
  ownerLangRule,
};
