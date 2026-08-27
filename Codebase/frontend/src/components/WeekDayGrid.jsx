import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HOURS, ymd } from '../lib/calendar';
import { chipMetaFor, isReadOnly, sourceOf } from '../lib/calendarEvents';
import './AutomationCalendar.css';

const HOUR_PX = 56;

/**
 * Postiz-style hourly grid: one column per day, one row per hour. Scheduled
 * posts render as coloured blocks at their hour; an empty slot shows a "+" on
 * hover to open Create Post prefilled for that exact day and time. Chips are
 * draggable onto any other slot to reschedule down to the hour.
 */
export default function WeekDayGrid({ days, byDay, onSlotClick, onDropSlot, onViewEvent, busyId }) {
  const { i18n } = useTranslation();
  const scrollRef = useRef(null);
  const [hoverSlot, setHoverSlot] = useState(null); // `${dayKey}-${hour}`
  const todayKey = ymd(new Date());

  // Bucket each day's events by their local hour once per render.
  const byDayHour = useMemo(() => {
    const map = {};
    for (const day of days) {
      const key = ymd(day);
      const hours = {};
      for (const ev of byDay[key] || []) {
        const h = new Date(ev.start.dateTime).getHours();
        (hours[h] ||= []).push(ev);
      }
      map[key] = hours;
    }
    return map;
  }, [days, byDay]);

  // Land on the current time when the grid first mounts (or the view/range
  // changes), so a fresh Week/Day view doesn't dump the owner at midnight.
  useEffect(() => {
    const now = new Date();
    const target = Math.max(0, now.getHours() - 2) * HOUR_PX;
    scrollRef.current?.scrollTo({ top: target });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length, days[0] && ymd(days[0])]);

  const slotDate = (day, hour) => {
    const d = new Date(day);
    d.setHours(hour, 0, 0, 0);
    return d;
  };

  const gridStyle = { gridTemplateColumns: `var(--wdg-time-w, 64px) repeat(${days.length}, 1fr)` };

  return (
    <div className="wdg">
      <div className="wdg-head" style={gridStyle}>
        <div className="wdg-time-col" />
        {days.map((d) => {
          const key = ymd(d);
          return (
            <div key={key} className={`wdg-day-head ${key === todayKey ? 'is-today' : ''}`}>
              <span className="wdg-day-name">{d.toLocaleDateString(i18n.language, { weekday: 'short' })}</span>
              <span className="wdg-day-num">{d.toLocaleDateString(i18n.language, { day: 'numeric', month: '2-digit' })}</span>
            </div>
          );
        })}
      </div>

      <div className="wdg-body" style={gridStyle} ref={scrollRef}>
        <div className="wdg-time-col">
          {HOURS.map((h) => (
            <div key={h} className="wdg-time-label" style={{ height: HOUR_PX }}>
              {new Date(2000, 0, 1, h).toLocaleTimeString(i18n.language, { hour: 'numeric' })}
            </div>
          ))}
        </div>

        {days.map((d) => {
          const key = ymd(d);
          const hours = byDayHour[key] || {};
          return (
            <div key={key} className={`wdg-day-col ${key === todayKey ? 'is-today' : ''}`}>
              {HOURS.map((h) => {
                const slotKey = `${key}-${h}`;
                const evs = hours[h] || [];
                return (
                  <div
                    key={h}
                    className="wdg-slot"
                    style={{ height: HOUR_PX }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); onDropSlot(slotDate(d, h), e); }}
                    onMouseEnter={() => setHoverSlot(slotKey)}
                    onMouseLeave={() => setHoverSlot((s) => (s === slotKey ? null : s))}
                    onClick={() => { if (evs.length === 0) onSlotClick(slotDate(d, h)); }}
                  >
                    {evs.map((ev) => {
                      const m = chipMetaFor(ev);
                      const readOnly = isReadOnly(ev);
                      return (
                        <button
                          key={ev.id}
                          type="button"
                          className={`wdg-chip ${sourceOf(ev)} ${ev.status} ${busyId === ev.id ? 'is-busy' : ''}`}
                          style={{ '--chip-color': m.color }}
                          draggable={!readOnly}
                          onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', ev.id); }}
                          onClick={(e) => { e.stopPropagation(); onViewEvent?.(ev); }}
                        >
                          <i className={m.icon}></i>
                          <span className="wdg-chip-text">{ev.description || ev.summary}</span>
                        </button>
                      );
                    })}
                    {evs.length === 0 && hoverSlot === slotKey && (
                      <span className="wdg-slot-add"><i className="fa-solid fa-plus"></i></span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
