import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import CalendarGrid from './CalendarGrid';
import WeekDayGrid from './WeekDayGrid';
import PostListView from './PostListView';
import { DAY_MS, monthGrid, weekGrid, startOfDay, ymd } from '../lib/calendar';
import { chipMetaFor, isEditable, isReadOnly, sourceOf, statusOf, tagOf, toEditable } from '../lib/calendarEvents';
import './AutomationCalendar.css';

const VIEW_MODES = ['day', 'week', 'month'];

/**
 * Calendar tab: everything Markivo has scheduled or already done, on one
 * timeline. Reads the Google-Calendar-shaped /api/calendar/events feed, so the
 * same view would work against a real Google Calendar unchanged.
 *
 * Two independent switches, Postiz-style: a Day/Week/Month grid granularity,
 * and a Calendar-grid vs flat List display mode.
 */
export default function AutomationCalendar({ activeProfile, onCreatePost, onOpenAiGeneration, onOpenTemplates, onEditEvent }) {
  const { t, i18n } = useTranslation();

  const today = new Date();
  const [viewMode, setViewMode] = useState('week');
  const [displayMode, setDisplayMode] = useState('calendar'); // 'calendar' | 'list'
  const [cursor, setCursor] = useState(startOfDay(today));
  const [events, setEvents] = useState([]);
  const [allEvents, setAllEvents] = useState(null); // unbounded feed, fetched lazily for List view
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(ymd(today));
  const [busyId, setBusyId] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  const monthDays = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const weekDays = useMemo(() => weekGrid(cursor), [cursor]);
  const gridDays = viewMode === 'month' ? monthDays : viewMode === 'week' ? weekDays : [startOfDay(cursor)];

  // Bounded fetch for the calendar-grid modes (month/week/day) — only the
  // visible window.
  useEffect(() => {
    if (displayMode !== 'calendar') return;
    let cancelled = false;
    const timeMin = new Date(gridDays[0]).toISOString();
    const timeMax = new Date(gridDays[gridDays.length - 1].getTime() + DAY_MS).toISOString();
    api.get(`/api/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`)
      .then((data) => { if (!cancelled) { setEvents(data.items || []); setError(''); } })
      .catch((err) => { if (!cancelled) { setEvents([]); setError(err.message || t('common.somethingWentWrong', 'Something went wrong')); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMode, viewMode, gridDays[0] && ymd(gridDays[0]), gridDays[gridDays.length - 1] && ymd(gridDays[gridDays.length - 1]), reloadToken, activeProfile?.id, t]);

  // Unbounded fetch for List view — every post ever, independent of whatever
  // day/week/month the grid modes happen to be looking at.
  useEffect(() => {
    if (displayMode !== 'list') return;
    let cancelled = false;
    api.get('/api/calendar/events')
      .then((data) => { if (!cancelled) { setAllEvents(data.items || []); setError(''); } })
      .catch((err) => { if (!cancelled) { setAllEvents([]); setError(err.message || t('common.somethingWentWrong', 'Something went wrong')); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [displayMode, reloadToken, activeProfile?.id, t]);

  // Bucket events by local calendar day once, rather than filtering per cell.
  const byDay = useMemo(() => {
    const map = {};
    for (const ev of events) {
      const key = ymd(new Date(ev.start.dateTime));
      (map[key] ||= []).push(ev);
    }
    return map;
  }, [events]);

  const stepMonth = (delta) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  const stepWeek = (delta) => setCursor((c) => new Date(c.getTime() + delta * 7 * DAY_MS));
  const stepDay = (delta) => setCursor((c) => new Date(c.getTime() + delta * DAY_MS));
  const step = (delta) => {
    if (viewMode === 'month') stepMonth(delta);
    else if (viewMode === 'week') stepWeek(delta);
    else stepDay(delta);
  };
  const goToday = () => {
    const now = new Date();
    setCursor(startOfDay(now));
    setSelected(ymd(now));
  };

  const cancelEvent = async (ev) => {
    setBusyId(ev.id);
    setError('');
    try {
      await api.del(`/api/calendar/events/${ev.id}`);
      refresh();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setBusyId(null);
  };

  // Reschedule to an exact date+time (hour grids) or to a new day while
  // keeping the original time of day (month grid's whole-day drop target).
  const moveEvent = async (ev, target) => {
    let next;
    if (target instanceof Date) {
      next = target;
    } else {
      const original = new Date(ev.start.dateTime);
      const [y, m, d] = target.split('-').map(Number);
      next = new Date(y, m - 1, d, original.getHours(), original.getMinutes());
    }
    setBusyId(ev.id);
    setError('');
    try {
      await api.patch(`/api/calendar/events/${ev.id}`, { start: { dateTime: next.toISOString() } });
      refresh();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setBusyId(null);
  };

  const dropFromDataTransfer = (target, e) => {
    const id = e.dataTransfer.getData('text/plain');
    const ev = events.find((x) => x.id === id);
    if (ev && !isReadOnly(ev)) moveEvent(ev, target);
  };

  const rangeLabel = useMemo(() => {
    if (viewMode === 'month') return cursor.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });
    if (viewMode === 'day') return cursor.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const a = weekDays[0], b = weekDays[6];
    const fmt = (d) => d.toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${fmt(a)} – ${fmt(b)}`;
  }, [viewMode, cursor, weekDays, i18n.language]);

  const selectedEvents = byDay[selected] || [];

  return (
    <div className="automation-calendar">
      <div className="cal-head">
        <div>
          <h3><i className="fa-solid fa-calendar-days"></i> {t('calendar.title', 'Schedule')}</h3>
          <p className="text-muted cal-subtitle">
            {t('calendar.subtitle', 'Everything Markivo has scheduled or already done, on one timeline.')}
          </p>
        </div>
        <div className="cal-head-actions">
          {onOpenAiGeneration && (
            <button className="btn btn-secondary" onClick={onOpenAiGeneration} id="btn_cal_ai_generation">
              <i className="fa-solid fa-wand-magic-sparkles"></i> {t('calendar.aiGeneration', 'AI Generation')}
            </button>
          )}
          {onOpenTemplates && (
            <button className="btn btn-secondary" onClick={onOpenTemplates} id="btn_cal_edit_templates">
              <i className="fa-solid fa-shapes"></i> {t('calendar.editTemplates', 'Edit Templates')}
            </button>
          )}
          {onCreatePost && (
            <button className="btn btn-primary" onClick={() => onCreatePost()} id="btn_cal_create_post">
              <i className="fa-solid fa-plus"></i> {t('createPost.title', 'Create Post')}
            </button>
          )}
        </div>
      </div>

      <div className="cal-toolbar">
        {displayMode === 'calendar' ? (
          <div className="cal-nav">
            <button className="btn btn-secondary btn-sm" onClick={() => step(-1)} aria-label={t('calendar.prev', 'Previous')} id="btn_cal_prev">
              <i className="fa-solid fa-chevron-left"></i>
            </button>
            <span className="cal-range-label">{rangeLabel}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => step(1)} aria-label={t('calendar.next', 'Next')} id="btn_cal_next">
              <i className="fa-solid fa-chevron-right"></i>
            </button>
            <button className="btn btn-secondary btn-sm" onClick={goToday} id="btn_cal_today">{t('calendar.today', 'Today')}</button>
          </div>
        ) : <div />}

        <div className="cal-toolbar-right">
          {displayMode === 'calendar' && (
            <div className="cal-view-toggle" role="group" aria-label={t('calendar.viewMode', 'View')}>
              {VIEW_MODES.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`cal-view-btn ${viewMode === v ? 'active' : ''}`}
                  onClick={() => setViewMode(v)}
                  id={`btn_cal_view_${v}`}
                >
                  {t(`calendar.viewModes.${v}`, v[0].toUpperCase() + v.slice(1))}
                </button>
              ))}
            </div>
          )}
          <div className="cal-display-toggle" role="group" aria-label={t('calendar.displayMode', 'Display')}>
            <button
              type="button"
              className={`cal-display-btn ${displayMode === 'calendar' ? 'active' : ''}`}
              onClick={() => setDisplayMode('calendar')}
              title={t('calendar.calendarView', 'Calendar view')}
              id="btn_cal_display_calendar"
            >
              <i className="fa-solid fa-calendar"></i>
            </button>
            <button
              type="button"
              className={`cal-display-btn ${displayMode === 'list' ? 'active' : ''}`}
              onClick={() => setDisplayMode('list')}
              title={t('calendar.listView', 'List view')}
              id="btn_cal_display_list"
            >
              <i className="fa-solid fa-list"></i>
            </button>
          </div>
        </div>
      </div>

      {error && <div className="auth-error-box" role="alert">{error}</div>}

      {displayMode === 'list' ? (
        allEvents === null ? (
          <div className="text-center" style={{ padding: 40 }}><i className="fa-solid fa-spinner fa-spin fa-2x text-accent"></i></div>
        ) : (
          <PostListView events={allEvents} onCancel={cancelEvent} onEditEvent={onEditEvent} busyId={busyId} />
        )
      ) : loading ? (
        <div className="text-center" style={{ padding: 40 }}><i className="fa-solid fa-spinner fa-spin fa-2x text-accent"></i></div>
      ) : viewMode === 'month' ? (
        <>
          <CalendarGrid
            cursor={cursor}
            selected={selected}
            onSelect={setSelected}
            onDayDrop={(key, e) => dropFromDataTransfer(key, e)}
            dayContent={(key) => {
              const dayEvents = byDay[key] || [];
              const visible = dayEvents.slice(0, 2);
              const extra = dayEvents.length - visible.length;
              return (
                <span className="cal-day-chips">
                  {visible.map((ev) => {
                    const m = chipMetaFor(ev);
                    const hasMedia = !!ev.extendedProperties?.private?.mediaId;
                    return (
                      <span key={ev.id} className={`cal-chip ${sourceOf(ev)} ${ev.status}`} style={{ '--chip-color': m.color }}>
                        <i className={m.icon}></i>
                        <span className="cal-chip-text">{ev.description || ev.summary}</span>
                        {hasMedia && <i className="fa-solid fa-image cal-chip-media"></i>}
                      </span>
                    );
                  })}
                  {extra > 0 && (
                    <span className="cal-more">{t('calendar.showMore', { defaultValue: '+ Show more ({{count}})', count: extra })}</span>
                  )}
                </span>
              );
            }}
          />

          <div className="cal-agenda">
            <h4>{new Date(`${selected}T00:00:00`).toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}</h4>
            {selectedEvents.length === 0 ? (
              <p className="text-muted">{t('calendar.emptyDay', 'Nothing scheduled for this day.')}</p>
            ) : (
              <ul className="cal-event-list">
                {selectedEvents.map((ev) => {
                  const readOnly = isReadOnly(ev);
                  const time = new Date(ev.start.dateTime).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
                  const canDrag = !readOnly && statusOf(ev) === 'scheduled';
                  const canOpen = onEditEvent && isEditable(ev);
                  const tag = tagOf(ev);
                  return (
                    <li
                      key={ev.id}
                      className={`cal-event ${sourceOf(ev)} ${canOpen ? 'is-clickable' : ''}`}
                      draggable={canDrag}
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', ev.id)}
                      onClick={() => canOpen && onEditEvent(toEditable(ev))}
                    >
                      <span className="cal-event-time">{time}</span>
                      <div className="cal-event-body">
                        <strong>{ev.summary}</strong>
                        {ev.description && <p className="cal-event-desc">{ev.description}</p>}
                        {tag && <span className="cal-event-tag">{tag}</span>}
                      </div>
                      {canDrag && (
                        <button
                          className="btn-close"
                          disabled={busyId === ev.id}
                          onClick={(e) => { e.stopPropagation(); cancelEvent(ev); }}
                          aria-label={t('calendar.cancelEvent', 'Cancel this post')}
                          title={t('calendar.cancelEvent', 'Cancel this post')}
                        >
                          <i className="fa-solid fa-xmark"></i>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="cal-hint text-muted">
              <i className="fa-solid fa-circle-info"></i>{' '}
              {t('calendar.dragHint', 'Drag a scheduled post onto another day (or slot) to move it. Autopilot history cannot be changed.')}
            </p>
          </div>
        </>
      ) : (
        <WeekDayGrid
          days={gridDays}
          byDay={byDay}
          busyId={busyId}
          onSlotClick={(date) => onCreatePost?.(date)}
          onDropSlot={dropFromDataTransfer}
          onEditEvent={(ev) => onEditEvent?.(toEditable(ev))}
        />
      )}
    </div>
  );
}
