// Helpers for reading the Google-Calendar-shaped /api/calendar/events feed —
// one place to decode `extendedProperties.private`, so the calendar and the
// post panel never disagree on what an event is.

export const sourceOf = (ev) => (ev.extendedProperties?.private?.source) || 'scheduled_post';
export const isReadOnly = (ev) => ev.extendedProperties?.private?.readOnly === 'true';

// Autopilot history has no markivoStatus (it already happened), so it reads
// as posted.
export const statusOf = (ev) => ev.extendedProperties?.private?.markivoStatus
  || (sourceOf(ev) === 'autopilot' ? 'posted' : 'scheduled');

export const repeatOf = (ev) => ev.extendedProperties?.private?.repeatRule || '';

// A post can still be changed while it is a draft or waiting for its moment.
export const isEditable = (ev) => !isReadOnly(ev) && (statusOf(ev) === 'scheduled' || statusOf(ev) === 'draft');
