// ==========================================================================
// Autopilot's brief — what the owner tells Autopilot when the channel itself
// can't: WHAT to post about, the goal, HOW it should sound (tone, length,
// emojis), WHEN to post, how customers reach them, what to never say, and
// what's new this week.
//
// The questions are fixed and structured (choices, not essays) so an owner
// can answer them in under a minute on a phone. Which ones are asked depends
// on what Autopilot could learn from the channel (autopilotStyle.js): a
// channel with enough real posts already shows its tone, length, emojis and
// themes, so only what history can't tell is asked. "You decide" is always an
// answer ('auto'), and anything left blank when the owner sends their answers
// becomes 'auto' too — the owner is never asked the same thing twice.
//
// The labels below are English; the UI shows its own translation by question
// id and option value, and falls back to these.
// ==========================================================================

const AUTO = 'auto';

const THEMES = {
  products: 'Products and services',
  offers: 'Offers and discounts',
  news: 'News and announcements',
  tips: 'Useful tips and how-tos',
  behind_scenes: 'Behind the scenes',
  reviews: 'Customer reviews and stories',
  team: 'Our team',
  events: 'Holidays and events',
  fun: 'Fun and entertaining posts',
};
const GOALS = {
  visits: 'More people coming in',
  orders: 'More orders and sales',
  calls: 'More calls and messages',
  bookings: 'More bookings',
  followers: 'More followers',
  awareness: 'More people knowing us',
};
const TONES = {
  friendly: 'Friendly and warm',
  professional: 'Professional and trustworthy',
  playful: 'Playful and fun',
  premium: 'Premium and elegant',
  informative: 'Informative and expert',
};
const LENGTHS = { short: 'Short: 1-3 lines', medium: 'Medium: a paragraph', long: 'Long and detailed' };
const EMOJIS = { none: 'No emojis', few: 'A few emojis', many: 'Lots of emojis' };

const opts = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));

// The full catalogue, in the order the owner sees it.
const QUESTIONS = [
  { id: 'themes', type: 'multi', label: 'What should your posts be about?', hint: 'Pick a few. Autopilot rotates between them.', options: opts(THEMES), allowOther: true },
  { id: 'goal', type: 'single', label: 'What do you want most from your posts?', options: opts(GOALS) },
  { id: 'tone', type: 'single', label: 'How should your posts sound?', options: opts(TONES) },
  { id: 'length', type: 'single', label: 'How long should posts be?', options: opts(LENGTHS) },
  { id: 'emoji', type: 'single', label: 'Emojis?', options: opts(EMOJIS) },
  { id: 'schedule', type: 'schedule', label: 'How often and when should Autopilot post?', hint: 'Let Autopilot pick the best times, or choose days and times yourself.' },
  { id: 'cta', type: 'text', label: 'How do customers reach you or buy?', hint: 'A phone number, address, order link or @username. Autopilot never makes these up.', optional: true, max: 300 },
  { id: 'avoid', type: 'text', label: 'Anything Autopilot should never say or post?', optional: true, max: 300 },
  { id: 'news', type: 'text', label: 'Anything new this week? An offer, a new product, an event?', hint: 'Autopilot puts it in the next post and keeps it in mind for two weeks.', optional: true, max: 500 },
];
const BY_ID = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
const ALLOWED = { goal: GOALS, tone: TONES, length: LENGTHS, emoji: EMOJIS };

const NEWS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const answered = (v) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length) && v !== '';

/**
 * Which questions to ask now. Required ones are what Autopilot genuinely
 * cannot work out; optional ones ride along the first time only.
 * `scheduleChosen` = the owner has saved a schedule before.
 */
function missingQuestions({ brief, style, scheduleChosen }) {
  const b = brief || {};
  const thin = !(style && style.sufficient);
  const learnedThemes = !!(style && (style.themes || []).length);
  const required = [];
  if (!learnedThemes) required.push('themes');
  if (thin) required.push('goal', 'tone', 'length', 'emoji');
  if (thin && !scheduleChosen) required.push('schedule');
  const missing = required.filter((id) => (id === 'schedule' ? !answered(b.scheduleAsked) : !answered(b[id])));
  if (!missing.length) return { required: [], optional: [] };
  // Optional questions only alongside a real ask, and only if never seen.
  const optional = ['cta', 'avoid', 'news'].filter((id) => b[id] === undefined && !(b.seenOptional || []).includes(id));
  return { required: missing, optional };
}

// The questions as the client renders them.
function questionsFor(ids) {
  return ids.map((id) => BY_ID[id]).filter(Boolean).map((q) => ({ ...q, kind: 'brief' }));
}

const cleanText = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Validate an answers object into a brief patch. Unknown keys are dropped.
 * `asked` = ids that were asked; any of them left blank becomes 'auto'.
 * Returns { patch, schedule } — the schedule answer is stored on the config.
 */
function normalizeAnswers(raw, { asked = [], nowMs = Date.now(), prev = null } = {}) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const patch = {};
  if (a.themes !== undefined) {
    if (a.themes === AUTO) patch.themes = AUTO;
    else {
      const list = (Array.isArray(a.themes) ? a.themes : [a.themes]).map((t) => cleanText(t, 60)).filter(Boolean);
      const known = list.filter((t) => THEMES[t]);
      const custom = list.filter((t) => !THEMES[t]).slice(0, 3);
      if (known.length || custom.length) patch.themes = [...new Set([...known, ...custom])].slice(0, 8);
    }
  }
  if (a.themesOther) {
    const extra = String(a.themesOther).split(/[,;\n]/).map((t) => cleanText(t, 60)).filter(Boolean).slice(0, 3);
    if (extra.length) patch.themes = [...new Set([...(Array.isArray(patch.themes) ? patch.themes : []), ...extra])].slice(0, 8);
  }
  for (const key of Object.keys(ALLOWED)) {
    if (a[key] === undefined) continue;
    if (a[key] === AUTO || ALLOWED[key][a[key]]) patch[key] = a[key];
  }
  for (const key of ['cta', 'avoid']) {
    if (a[key] === undefined) continue;
    const text = cleanText(a[key], BY_ID[key].max);
    patch[key] = text || null; // emptying a field clears it
  }
  if (a.news !== undefined) {
    const text = cleanText(a.news, BY_ID.news.max);
    patch.news = text || null;
    patch.newsAt = text ? new Date(nowMs).toISOString() : null;
  }
  let scheduleAnswer;
  if (a.schedule !== undefined && a.schedule !== null) {
    scheduleAnswer = a.schedule === AUTO ? { mode: 'smart' } : a.schedule;
    patch.scheduleAsked = 'answered';
  }
  // Blank required answers become "you decide"; optional ones become seen.
  for (const id of asked) {
    const q = BY_ID[id];
    if (!q) continue;
    if (q.optional) continue;
    if (id === 'schedule') {
      if (!patch.scheduleAsked) patch.scheduleAsked = AUTO;
    } else if (!answered(patch[id])) {
      patch[id] = AUTO;
    }
  }
  const optionalAsked = asked.filter((id) => BY_ID[id] && BY_ID[id].optional);
  if (optionalAsked.length) patch.seenOptional = [...new Set([...((prev && prev.seenOptional) || []), ...optionalAsked])];
  return { patch, schedule: scheduleAnswer };
}

const isSet = (v) => answered(v) && v !== AUTO;

// The news is current for two weeks after the owner wrote it.
function currentNews(brief, nowMs = Date.now()) {
  if (!brief || !brief.news || !brief.newsAt) return null;
  return nowMs - Date.parse(brief.newsAt) < NEWS_TTL_MS ? { text: brief.news, at: brief.newsAt } : null;
}

/** The brief as a prompt block (English labels). '' when nothing is set. */
function briefDigest(brief, nowMs = Date.now()) {
  const b = brief || {};
  const lines = [];
  if (Array.isArray(b.themes) && b.themes.length) lines.push(`Topics the owner wants: ${b.themes.map((t) => THEMES[t] || t).join(', ')}`);
  if (isSet(b.goal)) lines.push(`Goal of every post: ${GOALS[b.goal]}`);
  if (isSet(b.tone)) lines.push(`Tone: ${TONES[b.tone]}`);
  if (isSet(b.length)) lines.push(`Length: ${LENGTHS[b.length]}`);
  if (isSet(b.emoji)) lines.push(`Emojis: ${EMOJIS[b.emoji]}`);
  if (b.cta) lines.push(`How customers reach or buy (use exactly as written, never invent others): ${b.cta}`);
  if (b.avoid) lines.push(`Never say or post: ${b.avoid}`);
  const news = currentNews(b, nowMs);
  if (news) lines.push(`What's new, from the owner (${news.at.slice(0, 10)}): ${news.text}`);
  return lines.length ? `THE OWNER'S BRIEF FOR AUTOPILOT (follow it; it overrides habits learned from old posts):\n${lines.join('\n')}` : '';
}

// Default topics when neither the owner nor the channel names any.
const DEFAULT_THEMES = ['products', 'offers', 'tips', 'behind_scenes', 'reviews'];

/**
 * The topics Autopilot rotates through: the owner's choice wins, then what
 * the channel was learned to post about (weighted by share, nudged toward
 * themes that get more views), then sensible defaults.
 * Returns [{ key, name, weight }].
 */
function themePool({ brief, style }) {
  const chosen = brief && Array.isArray(brief.themes) ? brief.themes : [];
  if (chosen.length) return chosen.map((t) => ({ key: t, name: THEMES[t] || t, weight: 1 }));
  const learned = (style && style.themes) || [];
  if (learned.length) {
    return learned.map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description,
      // Share sets the mix; performance above/below the channel median
      // moves it by up to half either way.
      weight: Math.max(5, t.share || 0) * (t.performance ? Math.min(1.5, Math.max(0.5, t.performance)) : 1),
    }));
  }
  return DEFAULT_THEMES.map((t) => ({ key: t, name: THEMES[t], weight: 1 }));
}

/**
 * Next topic: the one most behind its share of recent posts; with three or
 * more topics, never the same as the last post. Deterministic.
 * `recent` = theme keys of Autopilot's recent posts, newest first.
 */
function pickTheme(pool, recent = []) {
  if (!pool.length) return null;
  const window = recent.slice(0, 10);
  const total = pool.reduce((a, t) => a + t.weight, 0);
  const scored = pool.map((t, i) => {
    const used = window.filter((k) => k === t.key).length;
    const target = (t.weight / total) * (window.length + 1);
    return { t, i, deficit: target - used };
  });
  const candidates = pool.length > 2 ? scored.filter((s) => s.t.key !== window[0]) : scored;
  candidates.sort((a, b) => b.deficit - a.deficit || b.t.weight - a.t.weight || a.i - b.i);
  return candidates[0].t;
}

module.exports = {
  AUTO,
  THEMES,
  GOALS,
  TONES,
  LENGTHS,
  EMOJIS,
  QUESTIONS,
  NEWS_TTL_MS,
  missingQuestions,
  questionsFor,
  normalizeAnswers,
  currentNews,
  briefDigest,
  themePool,
  pickTheme,
};
