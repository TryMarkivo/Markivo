import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import { DAY_MS, monthGrid, weekGrid, startOfDay, ymd } from '../lib/calendar';
import { isEditable, sourceOf, statusOf } from '../lib/calendarEvents';
import { dayLong, monthYear, timeOf, weekRange, weekdayShort } from '../lib/dates';
import Icon, { ChannelMark } from './ui/Icon';
import ApprovalsStrip from './ApprovalsStrip';
import './PostsCalendar.css';

const platformOf = (ev) => ev.extendedProperties?.private?.platform || '';

// Posts are what the calendar is for. Autopilot's own log (analysis runs,
// skipped turns) stays on the Autopilot tab; anything it actually published or
// scheduled is already a real post row here.
const isPost = (ev) => sourceOf(ev) !== 'autopilot';

// New post on a given day: 10:00, or the next full hour if that has passed.
const defaultTimeOn = (day) => {
  const when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10, 0);
  const soon = Date.now() + 60 * 60000;
  return when.getTime() < soon ? new Date(Math.ceil(soon / 3600000) * 3600000) : when;
};

const STATUS_BADGE = {
  draft: ['', 'Draft'],
  posted: ['is-ok', 'Posted'],
  failed: ['is-danger', 'Failed'],
};

/** One post on the calendar, as a card (week) or a single line (month). */
function PostItem({ ev, compact, onOpen, lang }) {
  const { t } = useTranslation();
  const status = statusOf(ev);
  const time = timeOf(new Date(ev.start.dateTime), lang);
  const canMove = isEditable(ev);
  const hasMedia = !!ev.extendedProperties?.private?.mediaId;
  const badge = STATUS_BADGE[status];

  return (
    <button
      type="button"
      className={`pc-post is-${status}${compact ? ' is-compact' : ''}`}
      draggable={canMove}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', ev.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={(e) => { e.stopPropagation(); onOpen(ev); }}
      id={`post_${ev.id}`}
    >
      <span className="pc-post-meta">
        <ChannelMark channel={platformOf(ev)} size={compact ? 11 : 13} />
        <span className="pc-post-time">{time}</span>
        {!compact && hasMedia && <span className="pc-post-media" title={t('posts.hasMedia', 'Has a photo or video')}><Icon name="image" size={13} /></span>}
        {!compact && badge && <span className={`ui-badge ${badge[0]}`}>{t(`posts.status.${status}`, badge[1])}</span>}
      </span>
      <span className="pc-post-text">{ev.description || t('posts.noText', 'No text yet')}</span>
    </button>
  );
}

/**
 * The Calendar tab: every post in one place, Week or Month, with posts that
 * need the owner's approval pinned on top. Clicking a post or an empty day
 * hands off to the post panel (owned by Dashboard so other tabs can open it).
 */
export default function PostsCalendar({ activeProfile, onNewPost, onOpenPost, onNotice }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const [view, setView] = useState(() => {
    try { return localStorage.getItem('markivo_cal_view') === 'month' ? 'month' : 'week'; } catch { return 'week'; }
  });
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [dropKey, setDropKey] = useState(null);

  useEffect(() => {
    try { localStorage.setItem('markivo_cal_view', view); } catch { /* per-viewer convenience only */ }
  }, [view]);

  const days = useMemo(
    () => (view === 'month' ? monthGrid(cursor.getFullYear(), cursor.getMonth()) : weekGrid(cursor)),
    [view, cursor],
  );
  const firstKey = ymd(days[0]);
  const lastKey = ymd(days[days.length - 1]);

  useEffect(() => {
    let cancelled = false;
    const timeMin = new Date(days[0]).toISOString();
    const timeMax = new Date(days[days.length - 1].getTime() + DAY_MS).toISOString();
    api.get(`/api/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`)
      .then((data) => { if (!cancelled) { setEvents((data.items || []).filter(isPost)); setError(''); } })
      .catch((err) => { if (!cancelled) { setEvents([]); setError(err.message || t('common.somethingWentWrong', 'Something went wrong')); } });
    return () => { cancelled = true; };
    // days is derived from view+cursor; the keys pin the actual window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey, lastKey, reload, activeProfile?.id]);

  const byDay = useMemo(() => {
    const map = {};
    for (const ev of events || []) (map[ymd(new Date(ev.start.dateTime))] ||= []).push(ev);
    for (const k of Object.keys(map)) map[k].sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime));
    return map;
  }, [events]);

  const todayKey = ymd(new Date());

  const step = (delta) => setCursor((c) => (view === 'month'
    ? new Date(c.getFullYear(), c.getMonth() + delta, 1)
    : new Date(c.getTime() + delta * 7 * DAY_MS)));

  const rangeLabel = useMemo(
    () => (view === 'month' ? monthYear(cursor, lang) : weekRange(days[0], days[6], lang)),
    [view, cursor, days, lang],
  );

  const newPostOn = (day) => onNewPost(defaultTimeOn(day));

  // Drag a post to another day; it keeps its time of day.
  const moveTo = async (key, e) => {
    e.preventDefault();
    setDropKey(null);
    const id = e.dataTransfer.getData('text/plain');
    const ev = (events || []).find((x) => x.id === id);
    if (!ev || !isEditable(ev) || ymd(new Date(ev.start.dateTime)) === key) return;
    const from = new Date(ev.start.dateTime);
    const [y, m, d] = key.split('-').map(Number);
    const next = new Date(y, m - 1, d, from.getHours(), from.getMinutes());
    // Move it on screen right away; put it back if the server says no.
    setEvents((list) => list.map((x) => (x.id === id ? { ...x, start: { dateTime: next.toISOString() } } : x)));
    try {
      await api.patch(`/api/calendar/events/${id}`, { start: { dateTime: next.toISOString() } });
      onNotice?.(t('posts.moved', { defaultValue: 'Moved to {{day}}', day: dayLong(next, lang) }));
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
      setReload((n) => n + 1);
    }
  };

  const dropProps = (key) => ({
    onDragOver: (e) => { e.preventDefault(); if (dropKey !== key) setDropKey(key); },
    onDragLeave: () => setDropKey((k) => (k === key ? null : k)),
    onDrop: (e) => moveTo(key, e),
  });

  const weekdayNames = useMemo(
    () => weekGrid(new Date(2024, 0, 1)).map((d) => weekdayShort(d, lang)),
    [lang],
  );

  const total = (events || []).length;

  return (
    <div className="ui pc">
      <header className="pc-head">
        <h1>{t('posts.title', 'Calendar')}</h1>
        <div className="pc-nav">
          <button type="button" className="ui-icon-btn" onClick={() => step(-1)} aria-label={t('calendar.prev', 'Previous')} id="btn_cal_prev">
            <Icon name="chevronLeft" />
          </button>
          <span className="pc-range" aria-live="polite">{rangeLabel}</span>
          <button type="button" className="ui-icon-btn" onClick={() => step(1)} aria-label={t('calendar.next', 'Next')} id="btn_cal_next">
            <Icon name="chevronRight" />
          </button>
          <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={() => setCursor(startOfDay(new Date()))} id="btn_cal_today">
            {t('calendar.today', 'Today')}
          </button>
        </div>
        <div className="pc-head-right">
          <div className="ui-seg" role="group" aria-label={t('calendar.viewMode', 'View')}>
            {['week', 'month'].map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} id={`btn_cal_view_${v}`}>
                {t(`calendar.viewModes.${v}`, v === 'week' ? 'Week' : 'Month')}
              </button>
            ))}
          </div>
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => onNewPost(null)} id="btn_cal_create_post">
            <Icon name="plus" /> {t('posts.newPost', 'New post')}
          </button>
        </div>
      </header>

      <ApprovalsStrip activeProfile={activeProfile} onChanged={() => setReload((n) => n + 1)} onNotice={onNotice} />

      {error && <div className="ui-alert pc-error" role="alert">{error}</div>}

      {events === null ? (
        <div className="pc-loading"><Icon name="spinner" size={20} /></div>
      ) : view === 'week' ? (
        <div className="pc-week">
          {days.map((day) => {
            const key = ymd(day);
            const list = byDay[key] || [];
            const past = key < todayKey;
            return (
              <section
                key={key}
                className={`pc-day${key === todayKey ? ' is-today' : ''}${past ? ' is-past' : ''}${dropKey === key ? ' is-drop' : ''}${list.length ? '' : ' is-empty'}`}
                {...dropProps(key)}
                aria-label={dayLong(day, lang)}
              >
                <header className="pc-day-head">
                  <span className="pc-day-name">{weekdayShort(day, lang)}</span>
                  <span className="pc-day-num">{day.getDate()}</span>
                  <span className="pc-day-full">{dayLong(day, lang)}</span>
                </header>
                <div className="pc-day-body">
                  {list.map((ev) => <PostItem key={ev.id} ev={ev} onOpen={onOpenPost} lang={lang} />)}
                  {!past && (
                    <button
                      type="button"
                      className="pc-add"
                      onClick={() => newPostOn(day)}
                      aria-label={t('posts.addOn', { defaultValue: 'Add a post on {{day}}', day: dayLong(day, lang) })}
                    >
                      <Icon name="plus" size={14} /> <span>{t('posts.add', 'Add')}</span>
                    </button>
                  )}
                  {past && !list.length && <span className="pc-day-none">{t('posts.nothing', 'Nothing posted')}</span>}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="pc-month">
          <div className="pc-month-head" aria-hidden="true">
            {weekdayNames.map((n) => <span key={n}>{n}</span>)}
          </div>
          <div className="pc-month-grid">
            {days.map((day) => {
              const key = ymd(day);
              const list = byDay[key] || [];
              const outside = day.getMonth() !== cursor.getMonth();
              const shown = list.slice(0, 3);
              return (
                <div
                  key={key}
                  className={`pc-cell${outside ? ' is-outside' : ''}${key === todayKey ? ' is-today' : ''}${dropKey === key ? ' is-drop' : ''}`}
                  {...dropProps(key)}
                >
                  <button
                    type="button"
                    className="pc-cell-num"
                    onClick={() => { setCursor(day); setView('week'); }}
                    title={t('posts.openWeek', 'Open this week')}
                  >
                    {day.getDate()}
                  </button>
                  <div className="pc-cell-posts">
                    {shown.map((ev) => <PostItem key={ev.id} ev={ev} compact onOpen={onOpenPost} lang={lang} />)}
                    {list.length > shown.length && (
                      <button type="button" className="pc-more" onClick={() => { setCursor(day); setView('week'); }}>
                        {t('posts.more', { defaultValue: '{{count}} more', count: list.length - shown.length })}
                      </button>
                    )}
                  </div>
                  {list.length > 0 && <span className="pc-cell-dots" aria-hidden="true">{list.length}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {events !== null && total === 0 && !error && (
        <p className="pc-empty">
          {view === 'week'
            ? t('posts.emptyWeek', 'No posts this week yet. Pick a day to add one, or start with New post.')
            : t('posts.emptyMonth', 'No posts this month yet.')}
        </p>
      )}
    </div>
  );
}
