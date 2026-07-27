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
