// Saved AI writing, shown in the language the owner is reading the app in now.
//
// Media briefs, edit plans and competitor insights are written once — in the
// owner's language at that moment — and stored. When the owner later switches
// the UI language, the owner-facing text is translated ONCE per language and
// the result is kept on the record itself (`translations[lang]`, keyed by each
// field's path), so switching back and forth costs nothing after the first
// view. Customer-facing words (caption, spoken script) follow the business's
// audience languages instead, and text a model renders from (renderPrompt, the
// headline baked into the image) is never touched.
//
// Never throws: with no Gemini key, or when a translation fails, the stored
// original is returned as it is.

const gemini = require('./gemini');

// Keys that are codes, URLs or model prompts — never translated.
const SKIP_KEYS = new Set([
  'renderPrompt', 'headline', 'engineStatus', 'mode', 'kind', 'status', 'lang', 'translations',
  'note', 'url', 'filePath', 'operationId', 'id', 'source', 'time',
]);

const HAS_WORDS = /\p{L}{2,}/u;

/** Best guess at the language of stored text with no `lang` tag (records made before tagging). */
function detectLang(text) {
  const t = String(text || '');
  const cyr = (t.match(/\p{Script=Cyrillic}/gu) || []).length;
  const lat = (t.match(/[A-Za-z]/g) || []).length;
  if (cyr > lat) return 'ru';
  // Uzbek needs two signals: its o'/g' letters (not an English "dog's") and its
  // common short words — one alone shows up in English text too.
  const signals = (t.match(/[a-z][oOgG]['‘ʻ’](?!s\b)[a-z]/gi) || []).length +
    (t.match(/\b(?:va|uchun|bilan|yoki|qiling|bo'ladi|sizning|kerak)\b/gi) || []).length;
  return signals >= 2 ? 'uz' : 'en';
}

/** [{path, text}] for every translatable string leaf, depth-first. */
function collect(node, skip, path = '', out = []) {
  if (typeof node === 'string') {
    if (HAS_WORDS.test(node) && !skip(path)) out.push({ path, text: node });
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => collect(v, skip, path ? `${path}.${i}` : String(i), out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (!SKIP_KEYS.has(k)) collect(v, skip, path ? `${path}.${k}` : k, out);
    }
  }
  return out;
}

/** A deep copy of `node` with the strings at the given paths replaced. */
function apply(node, map, path = '') {
  if (typeof node === 'string') return map[path] != null ? map[path] : node;
  if (Array.isArray(node)) return node.map((v, i) => apply(v, map, path ? `${path}.${i}` : String(i)));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'translations') continue;
      out[k] = SKIP_KEYS.has(k) ? v : apply(v, map, path ? `${path}.${k}` : k);
    }
    return out;
  }
  return node;
}

/**
 * `doc` in `lang`. `skip(path)` excludes fields that must stay as written;
 * `save(docWithTranslations)` persists a newly made translation. Returns the
 * document without its translation cache.
 */
async function localize(doc, lang, { skip = () => false, save } = {}) {
  if (!doc || typeof doc !== 'object') return doc;
  const strings = collect(doc, skip);
  const plain = apply(doc, {});
  if (!lang || !strings.length) return plain;

  const from = doc.lang || detectLang(strings.map((s) => s.text).join(' '));
  if (from === lang) return plain;

  const cached = (doc.translations && doc.translations[lang]) || {};
  const missing = strings.filter((s) => cached[s.path] == null);
  if (!missing.length) return apply(doc, cached);

  const made = await gemini.translateStrings({ items: missing.map((s) => ({ id: s.path, text: s.text })), lang });
  if (!made) return plain;
  const merged = { ...cached, ...made };
  if (save) {
    try {
      save({ ...doc, lang: from, translations: { ...(doc.translations || {}), [lang]: merged } });
    } catch (err) {
      console.error('Could not store a translation:', err.message);
    }
  }
  return apply(doc, merged);
}

// The parts of a brief a CUSTOMER reads. They follow the audience's languages
// when the owner has set them; otherwise they follow the owner, like the rest.
const customerFacing = (path) => path === 'caption' || /^script\.\d+\.(?:spoken|onScreenText)$/.test(path);

/**
 * A media row's brief (and its edit plan, which is written separately and
 * carries its own language) in `lang`. Persists new translations on the row.
 */
async function localizeMedia(db, row, lang, { audienceLanguages } = {}) {
  if (!row || !row.brief) return row;
  const keepCustomer = Array.isArray(audienceLanguages) && audienceLanguages.length > 0;
  const { editPlan, ...briefOnly } = row.brief;
  let stored = row.brief;
  const persist = (patch) => {
    stored = { ...stored, ...patch };
    db.media.update(row.id, { brief: stored });
  };

  const brief = await localize(briefOnly, lang, {
    skip: (path) => keepCustomer && customerFacing(path),
    save: (doc) => persist(doc),
  });
  const plan = editPlan
    ? await localize(editPlan, lang, { save: (doc) => persist({ editPlan: doc }) })
    : undefined;
  return { ...row, brief: plan ? { ...brief, editPlan: plan } : brief };
}

/** A competitor insight in `lang`. Persists new translations on the insight. */
async function localizeInsight(db, insight, lang) {
  if (!insight || !insight.analysis) return insight;
  const analysis = await localize(insight.analysis, lang, {
    save: (doc) => db.competitorInsights.setAnalysis(insight.id, doc),
  });
  return { ...insight, analysis };
}

module.exports = { localize, localizeMedia, localizeInsight, detectLang };
