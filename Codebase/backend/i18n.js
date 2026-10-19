// The owner's UI language, server side.
//
// The web client sends its language as `Accept-Language` on every call
// (frontend/src/lib/api.js). Two things follow from it:
//   - `req.lang` (en | uz | ru) tells the AI which language to explain itself
//     in. Post copy is NOT steered by it — that follows the business's
//     audience languages, which can differ from the owner's UI.
//   - Error messages are translated on the way out, so the 130-odd
//     `res.json({ error: '...' })` call sites stay plain English and a new
//     message simply shows in English until a translation is added to
//     locales/uz.json. Other fixed sentences go through `tr(lang, english)`.
// Work with no request (the Autopilot worker) uses users.preferred_lang,
// which the client updates whenever the owner switches language.

const MESSAGES = {
  uz: require('./locales/uz.json'),
};

const SUPPORTED = ['en', 'uz', 'ru'];

// AI instructions name the language; Uzbek is pinned to Latin script, which is
// what the UI and the owners use.
const LANG_NAMES = { en: 'English', uz: 'Uzbek (Latin script)', ru: 'Russian' };

/** First supported language tag in an Accept-Language value, else English. */
function pickLang(header) {
  for (const part of String(header || '').split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase().split('-')[0];
    if (SUPPORTED.includes(tag)) return tag;
  }
  return 'en';
}

const UZ_TIER = { freemium: 'Bepul', free: 'Bepul', pro: 'Pro', ultimate: 'Ultimate' };
const UZ_BUCKET = { writing: 'matn', image: 'rasm', video: 'video' };
const uzTier = (t) => UZ_TIER[t] || t;

// Messages with values baked in. Each pattern matches the whole English text.
const PATTERNS = {
  uz: [
    [/^(writing|image|video) generation isn't included on the (\w+) plan — upgrade to unlock it\.$/,
      (m) => `${UZ_BUCKET[m[1]][0].toUpperCase()}${UZ_BUCKET[m[1]].slice(1)} yaratish ${uzTier(m[2])} tarifiga kirmaydi — undan foydalanish uchun tarifni yangilang.`],
    [/^You've used all (\d+) (writing|image|video) generations on your (\w+) plan this week\. Your allowance resets on (\S+) — or upgrade for more\.$/,
      (m) => `Bu hafta ${uzTier(m[3])} tarifidagi ${m[1]} ta ${UZ_BUCKET[m[2]]} generatsiyasining barchasidan foydalandingiz. Limit ${m[4]} kuni yangilanadi — yoki ko'proq uchun tarifni yangilang.`],
    [/^Post text must be (\d+) characters or fewer for this platform\.$/,
      (m) => `Bu platformada post matni ${m[1]} belgidan oshmasligi kerak.`],
    [/^No channel or group found yet\. Add @(\S+) to your channel as an administrator/,
      (m) => `Hali kanal yoki guruh topilmadi. @${m[1]} botini kanalingizga administrator sifatida qo'shing ("Xabarlarni joylash" ruxsati bilan), so'ng qaytadan urinib ko'ring — yoki @kanal manzilini qo'lda kiriting.`],
    [/^Unknown platform "(.+)"$/, (m) => `"${m[1]}" platformasi topilmadi`],
    [/^(.+) connects with its own setup card, not OAuth\.$/, (m) => `${m[1]} o'zining alohida sozlash kartasi orqali ulanadi.`],
    [/^Unknown detail key: (.+)$/, (m) => `Noma'lum ma'lumot turi: ${m[1]}`],
    [/^Publishing failed: (.*)$/s, (m) => `E'lon qilib bo'lmadi: ${m[1]}`],
    [/^You are already on the (\w+) plan$/, (m) => `Siz allaqachon ${uzTier(m[1])} tarifidasiz`],
    [/^Unknown plan "(.+)" — choose one of: (.+)$/, (m) => `"${m[1]}" tarifi topilmadi — quyidagilardan birini tanlang: ${m[2]}`],
    [/^A competitor can have at most (\d+) platform links$/, (m) => `Raqobatchida ko'pi bilan ${m[1]} ta platforma havolasi bo'lishi mumkin`],
    [/^(?:Each platform|Platform) must be one of: (.+)$/, (m) => `Platforma quyidagilardan biri bo'lishi kerak: ${m[1]}`],
    [/^Unsupported platform: (.+)$/, (m) => `${m[1]} platformasi qo'llab-quvvatlanmaydi`],
    // The image model's own refusal is English model text — keep it, but say
    // what happened in Uzbek first.
    [/^Media engine returned no image: (.*)$/s, (m) => `Rasm yaratilmadi. Model javobi: ${m[1]}`],
    [/^Media engine (?:returned no image|unreachable|answered|returned no operation handle)/,
      () => "Media yaratilmadi — birozdan so'ng qaytadan urinib ko'ring."],
    [/^Video download (?:failed|answered)/, () => "Videoni yuklab olib bo'lmadi — qaytadan urinib ko'ring."],
  ],
};

/**
 * A fixed sentence the server writes for the owner (an activity line, an
 * approval card, a chat reply), in `lang`. The English text is the key and the
 * fallback; {{name}} slots are filled from `params` after translation.
 */
function tr(lang, text, params = {}) {
  const template = (MESSAGES[lang] && MESSAGES[lang][text]) || text;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (params[key] == null ? '' : String(params[key])));
}

/** A stored language preference, or English when it is missing or unknown. */
const langOr = (lang) => (SUPPORTED.includes(lang) ? lang : 'en');

/** The message in `lang`, or the English original when there is no translation. */
function translate(message, lang) {
  if (typeof message !== 'string' || !MESSAGES[lang]) return message;
  const exact = MESSAGES[lang][message];
  if (exact) return exact;
  for (const [re, render] of PATTERNS[lang] || []) {
    const m = message.match(re);
    if (m) return render(m);
  }
  return message;
}

// `error` fields can sit below the top level — e.g. one failed video inside a
// batch of settled renders — so walk a few levels down. It copies rather than
// edits: a route may hand res.json an object it keeps using.
function translateErrors(body, lang, depth = 0) {
  if (!body || typeof body !== 'object' || depth > 3) return body;
  if (Array.isArray(body)) return body.map((item) => translateErrors(item, lang, depth + 1));
  if (Object.getPrototypeOf(body) !== Object.prototype) return body; // Date, Buffer, …
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    out[key] = key === 'error' && typeof value === 'string'
      ? translate(value, lang)
      : translateErrors(value, lang, depth + 1);
  }
  return out;
}

/** Express middleware: sets req.lang and translates outgoing `error` messages. */
function localize(req, res, next) {
  req.lang = pickLang(req.get('accept-language'));
  if (MESSAGES[req.lang]) {
    const json = res.json.bind(res);
    res.json = (body) => json(translateErrors(body, req.lang));
  }
  next();
}

module.exports = { localize, pickLang, translate, tr, langOr, LANG_NAMES, SUPPORTED };
