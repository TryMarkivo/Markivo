import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DAY_MS, monthGrid, ymd } from '../lib/calendar';
import './AutomationCalendar.css';

/**
 * The month calendar, shared by the Automations timeline and the "schedule this
 * post" picker so both look and behave identically — one implementation, one
 * stylesheet. Callers supply what goes INSIDE a day cell (`dayContent`) and may
 * grey out days (`isDisabled`); everything else is the same everywhere.
 */
export default function CalendarGrid({
  cursor,
  selected,
  onSelect,
  dayContent,
  isDisabled,
  onDayDrop,
}) {
  const { i18n } = useTranslation();

  const days = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const weekdays = useMemo(() => {
    // Monday-first weekday initials in the user's locale.
    const base = new Date(2024, 0, 1); // a Monday
    return Array.from({ length: 7 }, (_, i) =>
      new Date(base.getTime() + i * DAY_MS).toLocaleDateString(i18n.language, { weekday: 'short' }));
  }, [i18n.language]);

  const todayKey = ymd(new Date());

  return (
    <div className="cal-grid" role="grid">
      {weekdays.map((w) => <div key={w} className="cal-weekday">{w}</div>)}

      {days.map((d) => {
        const key = ymd(d);
        const outside = d.getMonth() !== cursor.getMonth();
        const disabled = isDisabled ? isDisabled(d) : false;
        return (
          <button
            key={key}
            type="button"
            role="gridcell"
            disabled={disabled}
            className={`cal-day ${outside ? 'outside' : ''} ${key === todayKey ? 'is-today' : ''} ${key === selected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`}
            onClick={() => !disabled && onSelect?.(key, d)}
            onDragOver={onDayDrop ? (e) => e.preventDefault() : undefined}
            onDrop={onDayDrop ? (e) => { e.preventDefault(); onDayDrop(key, e); } : undefined}
          >
            <span className="cal-day-num">{d.getDate()}</span>
            {dayContent?.(key, d)}
          </button>
        );
      })}
    </div>
  );
}

/** Month navigation header (prev / label / next / today), shared likewise. */
export function CalendarNav({ cursor, onStep, onToday }) {
  const { t, i18n } = useTranslation();
  const monthLabel = cursor.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });
  return (
    <div className="cal-nav">
      <button className="btn btn-secondary btn-sm" onClick={() => onStep(-1)} aria-label={t('calendar.prevMonth', 'Previous month')} id="btn_cal_prev">
        <i className="fa-solid fa-chevron-left"></i>
      </button>
      <span className="cal-month-label">{monthLabel}</span>
      <button className="btn btn-secondary btn-sm" onClick={() => onStep(1)} aria-label={t('calendar.nextMonth', 'Next month')} id="btn_cal_next">
        <i className="fa-solid fa-chevron-right"></i>
      </button>
      {onToday && (
        <button className="btn btn-secondary btn-sm" onClick={onToday} id="btn_cal_today">{t('calendar.today', 'Today')}</button>
      )}
    </div>
  );
}
