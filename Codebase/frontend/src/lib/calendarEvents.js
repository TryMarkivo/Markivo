// Shared helpers for reading the Google-Calendar-shaped /api/calendar/events
// feed, used by the Month grid, the Week/Day hourly grid, and the List view —
// one place to decode `extendedProperties.private` so the three views can
// never drift out of sync on what a chip means.
import { metaFor } from './platforms';

export const sourceOf = (ev) => (ev.extendedProperties?.private?.source) || 'scheduled_post';
export const isReadOnly = (ev) => ev.extendedProperties?.private?.readOnly === 'true';
export const isAutopilot = (ev) => sourceOf(ev) === 'autopilot';

// Autopilot history has no markivoStatus (it already happened); treat it as
// published so the List view's Published tab includes it.
export const statusOf = (ev) => ev.extendedProperties?.private?.markivoStatus || (isAutopilot(ev) ? 'posted' : 'scheduled');

export const tagOf = (ev) => ev.extendedProperties?.private?.tag || '';
export const repeatOf = (ev) => ev.extendedProperties?.private?.repeatRule || '';

// A calendar chip can be opened in the Edit Post composer only if it is a real
// post (not Autopilot history) still awaiting its moment — draft or scheduled.
export const isEditable = (ev) => !isReadOnly(ev) && (statusOf(ev) === 'scheduled' || statusOf(ev) === 'draft');

// Normalises a calendar event into the plain shape CreatePost's edit mode
// consumes, so it never has to know about Google Calendar's event/
// extendedProperties envelope.
export const toEditable = (ev) => ({
  id: ev.id,
  platform: ev.extendedProperties?.private?.platform || '',
  text: ev.description || '',
  mediaId: ev.extendedProperties?.private?.mediaId || null,
  scheduledTime: ev.start.dateTime,
  tag: tagOf(ev),
  repeatRule: repeatOf(ev),
  status: statusOf(ev),
});

// Chip icon/colour for a day cell — Autopilot history gets a fixed robot
// glyph; scheduled/posted rows resolve their real platform icon. 'instagram'
// is the bespoke connection's key (not a connector-registry key), so it maps
// to meta_instagram's visuals directly rather than falling through to the
// generic share-icon fallback.
export const chipMetaFor = (ev) => {
  if (isAutopilot(ev)) return { icon: 'fa-solid fa-robot', color: 'var(--accent-purple, #8338ec)' };
  const platform = ev.extendedProperties?.private?.platform || '';
  return metaFor(platform === 'instagram' ? 'meta_instagram' : platform);
};
