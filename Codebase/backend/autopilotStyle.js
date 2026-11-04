// ==========================================================================
// Autopilot learns the channel — HOW this business writes and WHAT it posts.
//
// Sources, all real posts by this business: what was read from its own
// connected channels (public t.me/s preview, Meta, YouTube), every channel
// post the shared Markivo bot has seen since it joined, posts the owner
// forwarded to the bot, and what Markivo already published for them.
// For now only the forwarded posts are used (config.autopilotLearnFrom =
// 'forwarded'); AUTOPILOT_LEARN_FROM=all brings the rest back.
//
// Two layers:
//   - measured (always, keyless): typical length, emojis, hashtags, line
//     breaks, lists, links, script, how often they post, median views, and
//     the best times to post (autopilotSchedule.bestTimes);
//   - read by the model (when GEMINI_API_KEY is set and there are enough
//     posts): the voice, formatting, recurring themes, habits and taboos.
//     Each theme names its posts, so its performance is computed here from
//     real view counts, not guessed.
// A few of the best real posts travel along as examples, because nothing
// teaches a voice like the voice itself.
//
// "Enough history" is MIN_POSTS. Below it Autopilot asks the owner instead
// (autopilotBrief.js). Re-learned at most once a day, or sooner when new
// posts arrive (but never more than hourly), so it costs at most a handful
// of model calls a day per business. Never throws.
// ==========================================================================

const schedule = require('./autopilotSchedule');
const config = require('./config');

const MIN_POSTS = 5;
const MAX_SAMPLES = 40;
const STALE_MS = 24 * 60 * 60 * 1000;
const MIN_RELEARN_MS = 60 * 60 * 1000;

const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/gu;
const LIST_LINE_RE = /^\s*(?:[-•▪️▫️◾️✅✔️➖➡️👉🔹🔸⭐️]|\d+[.)]|\p{Extended_Pictographic})\s*/u;
const LINK_RE = /(https?:\/\/|t\.me\/|@[A-Za-z0-9_]{4,})/i;

const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);

// Every real post we can learn from, newest first, de-duplicated. With
// learnFrom 'forwarded' (config.autopilotLearnFrom) only the posts the owner
// forwarded to the bot count — not the channel's own posts, nor Markivo's.
function collectSamples(db, profileId, { learnFrom = config.autopilotLearnFrom } = {}) {
  const forwardedOnly = learnFrom === 'forwarded';
  const own = db.ownContent.listByProfile(profileId, 200)
    .filter((p) => p.caption && p.caption.trim().length >= 15)
    .filter((p) => !forwardedOnly || p.source === 'forwarded')
    .map((p) => ({ text: p.caption.trim(), postedAt: p.postedAt, views: Number.isFinite(p.viewCount) ? p.viewCount : null, source: p.source || 'channel' }));
  const viaMarkivo = forwardedOnly ? [] : db.calendar.listByProfile(profileId)
    .filter((p) => p.status === 'posted' && p.post_text && p.post_text.trim().length >= 15)
    .map((p) => ({ text: p.post_text.trim(), postedAt: p.scheduled_time, views: null, source: 'markivo' }));
  const seen = new Set();
  return [...own, ...viaMarkivo]
    .sort((a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || '')))
    .filter((p) => {
      const k = norm(p.text);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_SAMPLES);
}

const round1 = (x) => Math.round(x * 10) / 10;
const share = (xs, fn) => (xs.length ? Math.round((xs.filter(fn).length / xs.length) * 100) : 0);
const median = (xs) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};

// The measurable habits of a set of posts. Pure.
function measure(samples) {
  const n = samples.length;
  if (!n) return { count: 0 };
  const lengths = samples.map((s) => s.text.length);
  const avgLength = Math.round(lengths.reduce((a, b) => a + b, 0) / n);
  const emojis = samples.map((s) => (s.text.match(EMOJI_RE) || []).length);
  const emojiPerPost = round1(emojis.reduce((a, b) => a + b, 0) / n);
  const tags = samples.map((s) => (s.text.match(HASHTAG_RE) || []).length);
  const lines = samples.map((s) => s.text.split('\n').filter((l) => l.trim()).length);
  const letters = samples.map((s) => s.text.replace(/[^\p{L}]/gu, ''));
  const cyr = letters.reduce((a, l) => a + (l.match(/\p{Script=Cyrillic}/gu) || []).length, 0);
  const lat = letters.reduce((a, l) => a + (l.match(/\p{Script=Latin}/gu) || []).length, 0);

  const dated = samples.map((s) => Date.parse(s.postedAt)).filter(Number.isFinite).sort((a, b) => a - b);
  let postsPerWeek = null;
  if (dated.length >= 3) {
    const weeks = Math.max(1, (dated[dated.length - 1] - dated[0]) / (7 * 24 * 60 * 60 * 1000));
    postsPerWeek = round1(dated.length / weeks);
  }

  return {
    count: n,
    avgLength,
    lengthLevel: avgLength <= 220 ? 'short' : avgLength <= 650 ? 'medium' : 'long',
    emojiPerPost,
    emojiLevel: emojiPerPost < 0.3 ? 'none' : emojiPerPost < 2.5 ? 'few' : 'many',
    hashtagShare: share(tags, (t) => t > 0),
    avgHashtags: round1(tags.reduce((a, b) => a + b, 0) / n),
    avgLines: round1(lines.reduce((a, b) => a + b, 0) / n),
    listShare: share(samples, (s) => s.text.split('\n').filter((l) => LIST_LINE_RE.test(l)).length >= 2),
    linkShare: share(samples, (s) => LINK_RE.test(s.text)),
    script: cyr + lat === 0 ? null : cyr > lat * 1.5 ? 'cyrillic' : lat > cyr * 1.5 ? 'latin' : 'mixed',
    postsPerWeek,
    medianViews: median(samples.map((s) => s.views)),
  };
}

// The best real posts to imitate: most-viewed when views are known, else newest.
function pickExamples(samples, count = 3) {
  const withViews = samples.filter((s) => Number.isFinite(s.views));
  const pool = withViews.length >= count ? withViews.slice().sort((a, b) => b.views - a.views) : samples;
  return pool.slice(0, count).map((s) => ({ text: s.text.slice(0, 700), views: s.views, postedAt: s.postedAt || null }));
}

// Themes from the model, with share and performance measured from the posts
// each theme claims. performance = theme's median views / channel median.
function scoreThemes(themes, samples, medianViews) {
  return (themes || []).map((t, i) => {
    const posts = (t.posts || []).map((idx) => samples[idx]).filter(Boolean);
    const views = median(posts.map((p) => p.views));
    return {
      key: `learned_${i + 1}`,
      name: t.name,
      description: t.description || '',
      share: samples.length ? Math.round((posts.length / samples.length) * 100) : 0,
      performance: medianViews && views ? round1(views / medianViews) : null,
    };
  }).filter((t) => t.name);
}

const fingerprintOf = (samples) => `${samples.length}:${samples[0] ? samples[0].postedAt || norm(samples[0].text) : ''}`;

/** Learn from scratch and store. */
async function learn({ db, gemini, profile, lang = 'en', timezone, nowMs = Date.now(), samples }) {
  const posts = samples || collectSamples(db, profile.id);
  const stats = measure(posts);
  let read = null;
  if (posts.length >= MIN_POSTS && gemini && gemini.learnChannelStyle) {
    try {
      read = await gemini.learnChannelStyle({
        posts: posts.slice(0, 30).map((p) => ({ text: p.text, views: p.views })),
        businessName: profile.businessName,
        category: profile.category,
        lang,
      });
    } catch (err) {
      console.error('learnChannelStyle threw unexpectedly:', err.message);
    }
  }
  const style = {
    sufficient: posts.length >= MIN_POSTS,
    stats,
    voice: read ? read.voice : null,
    formatting: read ? read.formatting : null,
    habits: read ? read.habits : [],
    avoid: read ? read.avoid : [],
    themes: read ? scoreThemes(read.themes, posts.slice(0, 30), stats.medianViews) : [],
    examples: posts.length ? pickExamples(posts) : [],
    timing: schedule.bestTimes({
      posts: posts.map((p) => ({ postedAt: p.postedAt, viewCount: p.views })),
      category: profile.category,
      timezone: timezone || schedule.DEFAULT_TZ,
    }),
    sources: [...new Set(posts.map((p) => p.source))],
    fingerprint: fingerprintOf(posts),
    sampleCount: posts.length,
    source: read ? 'gemini' : 'measured',
    learnedAt: new Date(nowMs).toISOString(),
  };
  return db.autonomous.saveStyle(profile.id, style);
}

/**
 * The stored style when it is still current, else a fresh one. `force`
 * re-learns now (the owner pressed "Re-learn"). Never throws.
 */
async function ensureStyle({ db, gemini, profile, lang, timezone, nowMs = Date.now(), force = false }) {
  try {
    const stored = db.autonomous.getStyle(profile.id);
    const samples = collectSamples(db, profile.id);
    if (!force && stored) {
      const age = nowMs - Date.parse(stored.learnedAt || 0);
      const same = stored.fingerprint === fingerprintOf(samples);
      const tzSame = !timezone || !stored.timing || stored.timing.source !== 'history' || stored.timezone === timezone;
      if ((same && tzSame && age < STALE_MS) || age < MIN_RELEARN_MS) return stored;
    }
    const style = await learn({ db, gemini, profile, lang, timezone, nowMs, samples });
    return timezone ? db.autonomous.saveStyle(profile.id, { ...style, timezone }) : style;
  } catch (err) {
    console.error('Learning the channel style failed (non-fatal):', err.message);
    return db.autonomous.getStyle(profile.id);
  }
}

const LEVEL_WORDS = {
  short: 'short (a few lines)', medium: 'medium (a paragraph or two)', long: 'long and detailed',
  none: 'no emojis', few: 'a few emojis', many: 'plenty of emojis',
};

/** The style as a prompt block for the copywriter. '' when nothing is known. */
function styleDigest(style) {
  if (!style || !style.sampleCount) return '';
  const s = style.stats || {};
  const lines = [`HOW THIS BUSINESS ALREADY WRITES (learned from ${style.sampleCount} of its own posts — write the new post the same way):`];
  if (style.voice) lines.push(`Voice: ${style.voice}`);
  if (style.formatting) lines.push(`Formatting: ${style.formatting}`);
  if (s.count) {
    lines.push(
      `Measured habits: about ${s.avgLength} characters (${LEVEL_WORDS[s.lengthLevel]}), ${LEVEL_WORDS[s.emojiLevel]} ` +
      `(~${s.emojiPerPost} per post), hashtags in ${s.hashtagShare}% of posts, ~${s.avgLines} lines, ` +
      `lists in ${s.listShare}% of posts, links or @mentions in ${s.linkShare}%` +
      `${s.script ? `, written in ${s.script === 'mixed' ? 'both Latin and Cyrillic' : `${s.script} script`}` : ''}.`
    );
  }
  if ((style.habits || []).length) lines.push(`Habits to keep: ${style.habits.join(' | ')}`);
  if ((style.avoid || []).length) lines.push(`This channel never: ${style.avoid.join(' | ')}`);
  if ((style.examples || []).length) {
    lines.push('REAL POSTS FROM THIS CHANNEL (match the voice and layout; never copy their content or facts):');
    style.examples.forEach((e, i) => lines.push(`--- example ${i + 1}${Number.isFinite(e.views) ? ` (${e.views} views)` : ''} ---\n${e.text}`));
  }
  return lines.join('\n');
}

module.exports = {
  MIN_POSTS,
  STALE_MS,
  collectSamples,
  measure,
  pickExamples,
  scoreThemes,
  learn,
  ensureStyle,
  styleDigest,
};
