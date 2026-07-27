import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import CalendarGrid, { CalendarNav } from './CalendarGrid';
import { DAY_MS, monthGrid, ymd } from '../lib/calendar';
import './AutomationCalendar.css';

const sourceOf = (ev) => (ev.extendedProperties?.private?.source) || 'scheduled_post';
const isReadOnly = (ev) => ev.extendedProperties?.private?.readOnly === 'true';

/**
 * Calendar for the Automations tab: everything Markivo has scheduled or already
 * done, on one timeline. Reads the Google-Calendar-shaped /api/calendar/events
 * feed, so the same view would work against a real Google Calendar unchanged.
 */
export default function AutomationCalendar({ activeProfile }) {
  const { t, i18n } = useTranslation();

  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(ymd(today));
  const [busyId, setBusyId] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  const days = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  useEffect(() => {
    let cancelled = false;
    const timeMin = new Date(days[0]).toISOString();
    const timeMax = new Date(days[days.length - 1].getTime() + DAY_MS).toISOString();
    api.get(`/api/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`)
      .then((data) => { if (!cancelled) { setEvents(data.items || []); setError(''); } })
      .catch((err) => { if (!cancelled) { setEvents([]); setError(err.message || t('common.somethingWentWrong', 'Something went wrong')); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days, reloadToken, activeProfile?.id, t]);

  // Bucket events by local calendar day once, rather than filtering per cell.
  const byDay = useMemo(() => {
    const map = {};
    for (const ev of events) {
      const key = ymd(new Date(ev.start.dateTime));
      (map[key] ||= []).push(ev);
    }
    return map;
  }, [events]);

  const step = (delta) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  const goToday = () => {
    const now = new Date();
    setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
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

  const moveEvent = async (ev, dayKey) => {
    // Keep the original time of day, move the date.
    const original = new Date(ev.start.dateTime);
    const [y, m, d] = dayKey.split('-').map(Number);
    const next = new Date(y, m - 1, d, original.getHours(), original.getMinutes());
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
        <CalendarNav cursor={cursor} onStep={step} onToday={goToday} />
      </div>

      {error && <div className="auth-error-box" role="alert">{error}</div>}

      {loading ? (
        <div className="text-center" style={{ padding: 40 }}><i className="fa-solid fa-spinner fa-spin fa-2x text-accent"></i></div>
      ) : (
        <>
          <CalendarGrid
            cursor={cursor}
            selected={selected}
            onSelect={setSelected}
            onDayDrop={(key, e) => {
              const id = e.dataTransfer.getData('text/plain');
              const ev = events.find((x) => x.id === id);
              if (ev && !isReadOnly(ev)) moveEvent(ev, key);
            }}
            dayContent={(key) => {
              const dayEvents = byDay[key] || [];
              return (
                <span className="cal-day-dots">
                  {dayEvents.slice(0, 4).map((ev) => (
                    <span key={ev.id} className={`cal-dot ${sourceOf(ev)} ${ev.status}`}></span>
                  ))}
                  {dayEvents.length > 4 && <span className="cal-more">+{dayEvents.length - 4}</span>}
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
                  const canEdit = !readOnly && ev.extendedProperties?.private?.markivoStatus === 'scheduled';
                  return (
                    <li
                      key={ev.id}
                      className={`cal-event ${sourceOf(ev)}`}
                      draggable={canEdit}
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', ev.id)}
                    >
                      <span className="cal-event-time">{time}</span>
                      <div className="cal-event-body">
                        <strong>{ev.summary}</strong>
                        {ev.description && <p className="cal-event-desc">{ev.description}</p>}
                      </div>
                      {canEdit && (
                        <button
                          className="btn-close"
                          disabled={busyId === ev.id}
                          onClick={() => cancelEvent(ev)}
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
              {t('calendar.dragHint', 'Drag a scheduled post onto another day to move it. Autopilot history cannot be changed.')}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
