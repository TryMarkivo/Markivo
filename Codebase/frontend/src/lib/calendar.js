// Calendar date helpers, shared by the Automations timeline and the schedule
// picker. They live outside the component files so both can import them without
// breaking fast refresh.

export const DAY_MS = 86400000;

// Month grid always starts on Monday and covers whole weeks, so every month
// renders as a stable 6x7 block that never reflows as you page through.
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // 0 = Monday
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
}

/** Local calendar day key — never toISOString(), which shifts across timezones. */
export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Monday-first week of 7 Dates containing `date`. */
export function weekGrid(date) {
  const offset = (date.getDay() + 6) % 7; // 0 = Monday
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
  return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
}

/** Hour-of-day labels (0..23), used by the week/day hourly grid. */
export const HOURS = Array.from({ length: 24 }, (_, i) => i);

export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
