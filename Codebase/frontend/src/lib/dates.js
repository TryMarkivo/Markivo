// Date labels in the interface language. Browsers ship little or no Uzbek
// calendar data (Chrome prints "2026 M11 8" and English weekday names), so
// Uzbek is spelled out here; Russian and English use Intl as normal.

const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
// Indexed by Date#getDay(): 0 = Sunday.
const UZ_DAYS = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];
const UZ_DAYS_SHORT = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];

const isUz = (lang) => String(lang || '').startsWith('uz');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n) => String(n).padStart(2, '0');

/** "Mon" / "Du" / "пн" */
export const weekdayShort = (d, lang) => (isUz(lang) ? UZ_DAYS_SHORT[d.getDay()] : d.toLocaleDateString(lang, { weekday: 'short' }));

/** "Wednesday, November 4" / "chorshanba, 4-noyabr" / "среда, 4 ноября" */
export const dayLong = (d, lang) => (isUz(lang)
  ? `${UZ_DAYS[d.getDay()]}, ${d.getDate()}-${UZ_MONTHS[d.getMonth()]}`
  : d.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' }));

/** "November 2026" / "Noyabr 2026" / "ноябрь 2026 г." */
export const monthYear = (d, lang) => (isUz(lang)
  ? `${cap(UZ_MONTHS[d.getMonth()])} ${d.getFullYear()}`
  : cap(d.toLocaleDateString(lang, { month: 'long', year: 'numeric' })));

/** "2 – 8 November 2026" for a week, across months when it has to. */
export const weekRange = (a, b, lang) => {
  const sameMonth = a.getMonth() === b.getMonth();
  if (isUz(lang)) {
    return sameMonth
      ? `${a.getDate()}–${b.getDate()}-${UZ_MONTHS[b.getMonth()]}, ${b.getFullYear()}`
      : `${a.getDate()}-${UZ_MONTHS[a.getMonth()]} – ${b.getDate()}-${UZ_MONTHS[b.getMonth()]}, ${b.getFullYear()}`;
  }
  const left = a.toLocaleDateString(lang, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
  const right = b.toLocaleDateString(lang, { day: 'numeric', month: sameMonth ? 'long' : 'short', year: 'numeric' });
  return `${left} – ${right}`;
};

/** "10:00 AM" / "10:00" */
export const timeOf = (d, lang) => (isUz(lang)
  ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
  : d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }));

// Calendar parts of an instant in a given time zone (numeric, locale-free).
const partsIn = (iso, timeZone) => {
  const out = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(new Date(iso))) out[p.type] = p.value;
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: WD[out.weekday], month: +out.month - 1, day: +out.day, h: +out.hour % 24, mi: +out.minute };
};

/** A post's time in the business's own time zone: "Fri, Nov 6, 12:00" / "Ju, 6-noyabr, 12:00" / "пт, 6 нояб., 12:00" */
export const slotWhen = (iso, lang, timeZone = 'Asia/Tashkent') => {
  try {
    if (isUz(lang)) {
      const p = partsIn(iso, timeZone);
      return `${UZ_DAYS_SHORT[p.weekday]}, ${p.day}-${UZ_MONTHS[p.month]}, ${pad(p.h)}:${pad(p.mi)}`;
    }
    return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
};

/** Short weekday name by index (0 = Sunday): "Mon" / "Du" / "пн" */
export const weekdayShortOf = (index, lang) => weekdayShort(new Date(2026, 10, 1 + index), lang);
