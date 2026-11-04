import { useTranslation } from 'react-i18next';
import { weekdayShortOf } from '../../lib/dates';

// Monday first, the way people here read a week. 0 = Sunday (JS getDay).
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const PER_WEEK = [1, 2, 3, 4, 5, 7, 10, 14];
const ZONES = ['Asia/Tashkent', 'Asia/Samarkand', 'Asia/Almaty', 'Asia/Bishkek', 'Asia/Dushanbe', 'Asia/Ashgabat', 'Europe/Moscow', 'Europe/Istanbul', 'Asia/Dubai', 'Europe/London', 'UTC'];

const browserZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; }
};


/**
 * When Autopilot posts: "you decide" (N a week at the best times) or fixed
 * days and times, in a timezone. `value` is the schedule object the server
 * normalises; `best` is where smart times come from, for the hint.
 */
export default function ScheduleEditor({ value, onChange, disabled, best, idPrefix = 'ap' }) {
  const { t, i18n } = useTranslation();
  const v = value || { mode: 'smart', postsPerWeek: 3, days: [], times: [], timezone: 'Asia/Tashkent' };
  const set = (patch) => onChange({ ...v, ...patch });
  const zones = [...new Set([v.timezone, browserZone(), ...ZONES].filter(Boolean))];
  const fixed = v.mode === 'fixed';
  const days = fixed && v.days?.length ? v.days : (fixed ? [1, 3, 5] : []);
  const times = fixed && v.times?.length ? v.times : (fixed ? ['19:00'] : []);

  const toggleDay = (d) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    if (next.length) set({ days: next.sort() });
  };
  const setTime = (i, val) => {
    const next = times.slice();
    next[i] = val;
    set({ times: next });
  };

  return (
    <div className="ap-sched">
      <div className="ui-seg" role="group" aria-label={t('autopilot.sched.modeLabel', 'Who picks the times')}>
        <button type="button" aria-pressed={!fixed} disabled={disabled} onClick={() => set({ mode: 'smart' })} id={`${idPrefix}_sched_smart`}>
          {t('autopilot.sched.smart', 'Autopilot picks the best times')}
        </button>
        <button type="button" aria-pressed={fixed} disabled={disabled} onClick={() => set({ mode: 'fixed', days, times })} id={`${idPrefix}_sched_fixed`}>
          {t('autopilot.sched.fixed', 'I choose days and times')}
        </button>
      </div>

      {!fixed && (
        <div className="ap-sched-row">
          <label className="ui-label" htmlFor={`${idPrefix}_sched_per_week`}>{t('autopilot.sched.perWeek', 'Posts a week')}</label>
          <select
            id={`${idPrefix}_sched_per_week`}
            className="ui-select ap-sched-select"
            value={v.postsPerWeek || 3}
            disabled={disabled}
            onChange={(e) => set({ postsPerWeek: Number(e.target.value) })}
          >
            {PER_WEEK.map((n) => (
              <option key={n} value={n}>{t('autopilot.sched.perWeekOption', { count: n, defaultValue: '{{count}} a week' })}</option>
            ))}
          </select>
          {best?.times?.length > 0 && (
            <p className="ap-sched-hint">
              {best.source === 'history'
                ? t('autopilot.sched.bestHistory', { times: best.times.join(', '), defaultValue: 'Your posts get the most views around {{times}}, so Autopilot posts then.' })
                : t('autopilot.sched.bestCategory', { times: best.times.join(', '), defaultValue: 'Good times for a business like yours: {{times}}. Once your channel has more posts, Autopilot uses the times your posts do best.' })}
            </p>
          )}
        </div>
      )}

      {fixed && (
        <>
          <div className="ap-sched-row">
            <span className="ui-label">{t('autopilot.sched.days', 'Days')}</span>
            <div className="apq-chips">
              {WEEK.map((d) => (
                <button
                  type="button"
                  key={d}
                  className={`apq-chip ${days.includes(d) ? 'on' : ''}`}
                  aria-pressed={days.includes(d)}
                  disabled={disabled}
                  onClick={() => toggleDay(d)}
                >
                  {weekdayShortOf(d, i18n.language)}
                </button>
              ))}
            </div>
          </div>
          <div className="ap-sched-row">
            <span className="ui-label">{t('autopilot.sched.times', 'Times')}</span>
            <div className="ap-sched-times">
              {times.map((tm, i) => (
                <span key={i} className="ap-sched-time">
                  <input
                    type="time"
                    className="ui-input"
                    value={tm}
                    disabled={disabled}
                    aria-label={t('autopilot.sched.timeN', { n: i + 1, defaultValue: 'Time {{n}}' })}
                    onChange={(e) => setTime(i, e.target.value)}
                  />
                  {times.length > 1 && (
                    <button type="button" className="ui-icon-btn" disabled={disabled} onClick={() => set({ times: times.filter((_, j) => j !== i) })} aria-label={t('autopilot.sched.removeTime', 'Remove this time')}>
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  )}
                </span>
              ))}
              {times.length < 3 && (
                <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" disabled={disabled} onClick={() => set({ times: [...times, times.includes('12:00') ? '19:00' : '12:00'] })}>
                  <i className="fa-solid fa-plus"></i> {t('autopilot.sched.addTime', 'Add a time')}
                </button>
              )}
            </div>
            <p className="ap-sched-hint">
              {t('autopilot.sched.fixedCount', { count: days.length * times.length, defaultValue: '{{count}} posts a week.' })}
            </p>
          </div>
        </>
      )}

      <div className="ap-sched-row">
        <label className="ui-label" htmlFor={`${idPrefix}_sched_tz`}>{t('autopilot.sched.timezone', 'Time zone')}</label>
        <select id={`${idPrefix}_sched_tz`} className="ui-select ap-sched-select" value={v.timezone || 'Asia/Tashkent'} disabled={disabled} onChange={(e) => set({ timezone: e.target.value })}>
          {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
        </select>
      </div>
    </div>
  );
}
