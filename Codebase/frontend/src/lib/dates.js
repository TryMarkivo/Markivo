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
