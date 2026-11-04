// ==========================================================================
// Autopilot's posting plan — WHEN posts go out.
//
// Two modes, both turned into concrete time slots in the business's own
// timezone:
//   - fixed: the owner picks the days and the times ("Mon/Wed/Fri at 19:00").
//   - smart: the owner picks how many posts a week; Autopilot picks the days
//     and times. With enough history it uses the hours the channel's posts got
//     the most views at; otherwise sensible defaults for the kind of business.
//
// Everything here is deterministic and free of network and model calls, so a
// slot never depends on a model's mood and every rule is unit-tested.
// Timezones use Intl only (no library): a wall-clock time in the owner's zone
// is converted to UTC by measuring the zone's offset at that moment.
// ==========================================================================

const DEFAULT_TZ = 'Asia/Tashkent';
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_HISTORY_FOR_TIMING = 8;

// How long before a slot Autopilot writes its post. Auto-publish: an hour, so
// the post sits on the Calendar where the owner can still edit or delete it.
// Approval: half a day, so the owner has time to say yes before the slot.
const AUTO_LEAD_MS = 60 * 60 * 1000;
const APPROVAL_LEAD_MS = 12 * 60 * 60 * 1000;
// A slot missed by less than this (server restart, slow tick) still gets its post.
const GRACE_MS = 20 * 60 * 1000;

function validTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const fmtCache = new Map();
function partsIn(tz, ms) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }));
  }
  const out = {};
  for (const p of fmtCache.get(tz).formatToParts(new Date(ms))) out[p.type] = p.value;
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: +out.year, m: +out.month, d: +out.day, h: +out.hour % 24, mi: +out.minute, s: +out.second,
    weekday: WD[out.weekday],
  };
}

// Offset of `tz` from UTC at instant `ms`, in ms (Tashkent = +5h).
function tzOffsetMs(tz, ms) {
  const p = partsIn(tz, ms);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// Wall-clock time in `tz` -> UTC ms. Two passes settle DST edges.
function localToUtc(tz, y, m, d, h, mi) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let ms = guess - tzOffsetMs(tz, guess);
  const off2 = tzOffsetMs(tz, ms);
  if (guess - off2 !== ms) ms = guess - off2;
  return ms;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const pad = (n) => String(n).padStart(2, '0');
const normTime = (t) => {
  const m = TIME_RE.exec(String(t || '').trim());
  return m ? `${pad(+m[1])}:${m[2]}` : null;
};
const clampInt = (v, lo, hi, dflt) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/**
 * A valid schedule from whatever was stored or sent. A config saved before
 * schedules existed has only `frequency`: daily -> 7 a week, weekly -> 1.
 */
function normalizeSchedule(raw, legacyFrequency) {
  const legacyPerWeek = legacyFrequency === 'weekly' ? 1 : legacyFrequency === 'daily' ? 7 : 3;
  const r = raw && typeof raw === 'object' ? raw : {};
  const mode = r.mode === 'fixed' ? 'fixed' : 'smart';
  const days = [...new Set((Array.isArray(r.days) ? r.days : []).map((d) => parseInt(d, 10)).filter((d) => d >= 0 && d <= 6))].sort();
  const times = [...new Set((Array.isArray(r.times) ? r.times : []).map(normTime).filter(Boolean))].sort().slice(0, 3);
  const schedule = {
    mode,
    postsPerWeek: clampInt(r.postsPerWeek, 1, 14, legacyPerWeek),
    days,
    times,
    timezone: validTimezone(r.timezone) ? r.timezone : DEFAULT_TZ,
  };
  if (mode === 'fixed') {
    if (!schedule.days.length) schedule.days = [1, 3, 5];
    if (!schedule.times.length) schedule.times = ['19:00'];
    schedule.postsPerWeek = schedule.days.length * schedule.times.length;
  }
  return schedule;
}

// Good default hours by kind of business, best first. Matched on the
// free-text category, so they are deliberately broad.
const CATEGORY_TIMES = [
  [/cafe|coffee|restaurant|food|bakery|kafe|qahva|oshxona|ресторан|кафе|еда|pizza|burger|fast/i, ['12:00', '19:00'], 'food'],
  [/beauty|salon|barber|spa|nail|cosmetic|go'zallik|салон|красот/i, ['10:00', '18:00'], 'beauty'],
  [/shop|store|retail|cloth|fashion|boutique|do'kon|магазин|одежд/i, ['11:00', '20:00'], 'retail'],
  [/school|course|education|academy|tutor|training|o'quv|kurs|курс|школ|обучен/i, ['09:00', '18:00'], 'education'],
  [/gym|fitness|sport|yoga|sport zal|фитнес|спорт/i, ['07:00', '18:00'], 'fitness'],
  [/clinic|medical|dental|doctor|pharmacy|klinika|клиник|стомат/i, ['09:00', '17:00'], 'health'],
];
const DEFAULT_TIMES = ['10:00', '19:00'];

// Evenly spread weekdays (0 = Sunday) for N posts a week.
const SPREAD = {
  1: [4],
  2: [2, 5],
  3: [1, 3, 5],
  4: [1, 3, 5, 6],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
};

const median = (xs) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};

/**
 * The best hours (and weekdays) to post, from the channel's own history when
 * there is enough of it, else from the kind of business.
 * `posts` = [{ postedAt, viewCount }].
 */
function bestTimes({ posts = [], category = '', timezone = DEFAULT_TZ } = {}) {
  const dated = posts.filter((p) => p && p.postedAt && Number.isFinite(Date.parse(p.postedAt)));
  if (dated.length >= MIN_HISTORY_FOR_TIMING) {
    const med = median(dated.map((p) => p.viewCount));
    // A post's weight: 1 for being posted, scaled by how it did against the
    // channel's median when views are known.
    const weight = (p) => (med && Number.isFinite(p.viewCount) ? p.viewCount / med : 1);
    const byHour = new Map();
    const byDay = new Map();
    for (const p of dated) {
      const lp = partsIn(timezone, Date.parse(p.postedAt));
      const w = weight(p);
      const h = byHour.get(lp.h) || { n: 0, w: 0 };
      byHour.set(lp.h, { n: h.n + 1, w: h.w + w });
      const d = byDay.get(lp.weekday) || { n: 0, w: 0 };
      byDay.set(lp.weekday, { n: d.n + 1, w: d.w + w });
    }
    // Hours: total weight (habit x performance); a second time at least 3h away.
    const hours = [...byHour.entries()].sort((a, b) => b[1].w - a[1].w || a[0] - b[0]);
    const first = hours[0][0];
    const second = hours.find(([h]) => Math.abs(h - first) >= 3);
    const times = [first, second && second[0]].filter((h) => h != null).map((h) => `${pad(h)}:00`);
    // Days: average performance where views exist, otherwise how often.
    const days = [...byDay.entries()]
      .sort((a, b) => (med ? (b[1].w / b[1].n) - (a[1].w / a[1].n) : b[1].n - a[1].n) || a[0] - b[0])
      .map(([d]) => d);
    return { times, days, source: 'history', basedOn: dated.length, usedViews: !!med };
  }
  const hit = CATEGORY_TIMES.find(([re]) => re.test(category || ''));
  return { times: hit ? hit[1] : DEFAULT_TIMES, days: [], source: 'category', group: hit ? hit[2] : 'general', basedOn: dated.length };
}

// Which weekdays get a post, and at which times, for one week.
// Returns Map<weekday, string[] times>.
function weekPlan(schedule, best) {
  const plan = new Map();
  if (schedule.mode === 'fixed') {
    for (const d of schedule.days) plan.set(d, schedule.times.slice());
    return plan;
  }
  const times = (best && best.times && best.times.length ? best.times : DEFAULT_TIMES).slice(0, 2);
  const n = schedule.postsPerWeek;
  const single = Math.min(n, 7);
  // With real history and 3 or fewer posts, use the channel's best days.
  let days = SPREAD[single];
  if (best && best.source === 'history' && best.usedViews && single <= 3 && best.days.length >= single) {
    days = best.days.slice(0, single);
  }
  for (const d of days) plan.set(d, [times[0]]);
  // 8-14 a week: every day once, and twice on the spread of the extra ones.
  if (n > 7) {
    for (const d of SPREAD[n - 7]) plan.set(d, [times[0], times[1] || (times[0] === '19:00' ? '12:00' : '19:00')].sort());
  }
  return plan;
}

/**
 * The next `count` posting slots after `fromMs`, as [{ ms, at, weekday, time }].
 * Looks up to three weeks ahead.
 */
function upcomingSlots(schedule, { fromMs = Date.now(), count = 5, best = null } = {}) {
  const tz = schedule.timezone || DEFAULT_TZ;
  const plan = weekPlan(schedule, best);
  const out = [];
  const start = partsIn(tz, fromMs);
  for (let i = 0; i < 22 && out.length < count; i += 1) {
    // Walk calendar days in the owner's zone (noon avoids DST edges).
    const dayMs = localToUtc(tz, start.y, start.m, start.d, 12, 0) + i * DAY_MS;
    const lp = partsIn(tz, dayMs);
    for (const t of plan.get(lp.weekday) || []) {
      const [h, mi] = t.split(':').map(Number);
      const ms = localToUtc(tz, lp.y, lp.m, lp.d, h, mi);
      if (ms > fromMs) out.push({ ms, at: new Date(ms).toISOString(), weekday: lp.weekday, time: t });
    }
  }
  return out.sort((a, b) => a.ms - b.ms).slice(0, count);
}

const leadFor = (autoPublish) => (autoPublish ? AUTO_LEAD_MS : APPROVAL_LEAD_MS);

/**
 * The slot a run at `nowMs` should write for, if any: the first slot not yet
 * past (allowing GRACE_MS), and only once its lead window has opened.
 * Also returns when the following run is due.
 */
function slotDecision(schedule, { nowMs = Date.now(), autoPublish = true, best = null } = {}) {
  const lead = leadFor(autoPublish);
  const [slot, after] = upcomingSlots(schedule, { fromMs: nowMs - GRACE_MS, count: 2, best });
  if (!slot) return { due: null, nextRunAt: new Date(nowMs + DAY_MS).toISOString() };
  if (slot.ms - lead <= nowMs) {
    const next = after ? Math.max(after.ms - lead, slot.ms) : slot.ms + DAY_MS;
    return { due: slot, nextRunAt: new Date(Math.max(next, nowMs + 60 * 1000)).toISOString() };
  }
  return { due: null, nextRunAt: new Date(slot.ms - lead).toISOString(), upcoming: slot };
}

// Fixed-date occasions businesses in Uzbekistan post about. Month-day keys.
const OCCASIONS = {
  '01-01': 'New Year',
  '01-14': "Defenders of the Motherland Day",
  '02-14': "Valentine's Day",
  '03-08': "International Women's Day",
  '03-21': 'Navruz',
  '05-09': 'Day of Remembrance and Honour',
  '06-01': "Children's Day",
  '09-01': 'Independence Day',
  '10-01': "Teachers' Day",
  '12-08': 'Constitution Day',
  '12-31': "New Year's Eve",
};

// Occasions on the slot's day or within the next `days` days.
function occasionsNear(ms, { timezone = DEFAULT_TZ, days = 3 } = {}) {
  const out = [];
  for (let i = 0; i <= days; i += 1) {
    const p = partsIn(timezone, ms + i * DAY_MS);
    const name = OCCASIONS[`${pad(p.m)}-${pad(p.d)}`];
    if (name) out.push({ name, inDays: i });
  }
  return out;
}

// "Tuesday 19:00" in English for prompts (the model writes for that moment).
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function slotLabel(ms, timezone = DEFAULT_TZ) {
  const p = partsIn(timezone, ms);
  const part = p.h < 5 ? 'night' : p.h < 11 ? 'morning' : p.h < 16 ? 'afternoon' : p.h < 21 ? 'evening' : 'night';
  return `${WEEKDAYS_EN[p.weekday]} ${part}, ${pad(p.h)}:${pad(p.mi)}`;
}

module.exports = {
  DEFAULT_TZ,
  AUTO_LEAD_MS,
  APPROVAL_LEAD_MS,
  GRACE_MS,
  MIN_HISTORY_FOR_TIMING,
  validTimezone,
  tzOffsetMs,
  localToUtc,
  partsIn,
  normalizeSchedule,
  bestTimes,
  weekPlan,
  upcomingSlots,
  slotDecision,
  leadFor,
  occasionsNear,
  slotLabel,
};
