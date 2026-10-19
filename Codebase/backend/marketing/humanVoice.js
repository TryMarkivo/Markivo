// The human voice — what separates copy a person wrote from copy a model wrote.
//
// rubric.js catches marketing clichés ("best in town", "something special").
// This catches the other giveaway: the habits of machine-written text — the
// flowery verbs, the emoji-bullet scaffolding, the "Not just X — it's Y", the
// invented scene-setting — in English, Russian and Uzbek. It is used twice:
//   - VOICE / CHAT_VOICE are appended to every prompt that writes words a
//     customer reads (posts, captions, ad lines, scripts) or the owner reads
//     from Markiv;
//   - aiTells() is the deterministic gate after generation: a draft that still
//     shows a tell earns one rewrite with the tells named (ai.js#refineDraft).

const VOICE =
  'HUMAN VOICE — every word a customer reads or hears must sound like the owner (or their best ' +
  'staff member) wrote it on their phone, not like an AI or an agency:\n' +
  '- Say one thing. Short sentences, now and then a longer one. Plain words a regular would say out loud.\n' +
  '- Specific beats pretty: the real item, price, place and time from the business memory. No decorative ' +
  'adjectives ("rich", "perfect", "delightful", "exquisite"), no "harmony of", no "perfectly paired".\n' +
  '- Never invent a detail that is not in the memory: no made-up times of day, moods, weather, customer ' +
  'habits or family stories. If the memory says "the owner\'s mother bakes it", do not turn it into "my mom".\n' +
  '- No machine scaffolding: no emoji bullet lists or emoji at the start of several lines, no label lines ' +
  '("Price:", "Address:"), no markdown (**bold**, headings), at most one dash ' +
  'as punctuation, no "Not just X, it\'s Y", no "Whether you\'re… or…", no rhetorical-question opener, ' +
  'no three-adjective stacks, no sign-off like "We can\'t wait to see you!" or "Don\'t miss out!". On ' +
  'Telegram a single 📍 address line is fine when the post needs one.\n' +
  '- Emoji: zero to two, only where a person would naturally put one.\n' +
  '- Read it aloud. If it sounds like an ad voice-over, rewrite it like a message to a regular.\n' +
  '- Write each language as a native writes it, never translated: Uzbek as people in Tashkent write on ' +
  'Telegram — clear everyday literary Uzbek, not bookish or flowery ("uyg\'unlik", "hadya eting", ' +
  '"betakror", "unutilmas", "lazzatlaning" are tells); Russian — живой современный русский без штампов ' +
  '("идеально сочетается", "окунитесь", "побалуйте себя", "незабываемый", "не упустите", ' +
  '"насладитесь" — признаки шаблона).';

// How Markiv itself talks to the owner in chat.
const CHAT_VOICE =
  'HOW YOU TALK: like a sharp, friendly colleague texting the owner. Lead with the answer. Short ' +
  'paragraphs, no headings, no bold, no bullet walls (a short numbered list only for real steps). ' +
  'Never open with "Great question", "Absolutely", "Certainly" or "I\'d be happy to", and never close ' +
  'with "I hope this helps" or "Let me know if you need anything else". Use the business\'s real ' +
  'details, not generic advice.';

// Apostrophes vary by keyboard (o' o‘ oʻ o’) — compare on one form.
const norm = (text) => String(text || '').replace(/[‘’ʻʼ`]/g, "'");

// Each tell: a pattern and the plain-language fix the rewrite is told to make.
const TELLS = [
  [/\bwhether you(?:'re| are)\b/i, 'drop the "Whether you\'re… or…" construction'],
  [/\bnot just (?:a |an |the )?[\w' -]{1,30}[,—–-]+\s*(?:it's|it is|we're|we are|this is)\b/i, 'drop the "Not just X, it\'s Y" construction'],
  [/\b(?:indulge|elevate|unlock|unleash|embark|delve|immerse yourself|treat yourself|look no further|nestled|tapestry|symphony|exquisite|delightful|perfect blend|pairs? perfectly|perfectly paired|harmony of)\b/i, 'replace the flowery ad words with plain ones'],
  [/^\s*(?:tired of|looking for|craving|ever wondered|ready to|need a|want to)\b[^?\n]{0,80}\?/im, 'open with a concrete statement, not a rhetorical question'],
  [/\*\*[^*\n]+\*\*|^#{1,3}\s/m, 'remove the markdown formatting'],
  [/окунитесь|побалуйте себя|идеально сочета|незабываем|уникальн(?:ая|ый|ое|ую) (?:возможност|атмосфер|вкус)|не упустите|насладитесь|откройте для себя|гармони[яи] вкус/i, 'replace the Russian ad clichés with plain words'],
  [/uyg'unlig|hadya eting|betakror|unutilmas|lazzatlaning|rohatlaning|ajoyib lahza|imkoniyatni (?:qo'ldan )?boy bermang|o'zgacha ta'm|ta'mini his qiling/i, 'replace the bookish Uzbek ad phrases with everyday words'],
];

const EMOJI_LINE = /^\s*(?:\p{Extended_Pictographic}|\p{Regional_Indicator})/u;

/**
 * The machine-writing habits found in `text`, each as the fix to make. Empty
 * when it reads human. Cheap and deterministic — safe to run on every draft.
 */
function aiTells(text) {
  const t = norm(text);
  const found = TELLS.filter(([re]) => re.test(t)).map(([, fix]) => fix);
  const lines = t.split('\n').filter((l) => l.trim());
  if (lines.filter((l) => EMOJI_LINE.test(l)).length >= 3) found.push('stop starting lines with emoji — write sentences, not an emoji list');
  // A dash habit, in Latin-script copy only: Russian grammar uses the dash
  // ("Кусочек — 28 000 сумов"), and a range or a price after a dash is not a habit.
  const dashes = /\p{Script=Cyrillic}/u.test(t) ? [] : t.match(/(?<!\d)[—–](?!\s?\d)/g) || [];
  if (dashes.length >= 3) found.push('use at most one dash; let sentences end');
  if ((t.match(/!/g) || []).length >= 3) found.push('keep at most two exclamation marks');
  return found;
}

module.exports = { VOICE, CHAT_VOICE, aiTells };
