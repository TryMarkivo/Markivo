import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import { metaFor } from '../lib/platforms';
import CalendarGrid, { CalendarNav } from './CalendarGrid';
import './PublishModal.css';

// Quick times offered next to the clock, so the common cases are one tap.
const TIME_PRESETS = [
  { key: 'morning', value: '09:00' },
  { key: 'lunch', value: '13:00' },
  { key: 'evening', value: '18:30' },
];

const CAPTION_MAX = 2200;

/**
 * Publish one finished piece of media to any number of connected platforms,
 * now or on a schedule.
 *
 * Each platform is published through the SAME /api/content/post-now and
 * /api/content/schedule routes the Content Engine uses, one call per platform,
 * so a failure on one channel never hides a success on another — the per-
 * platform result is reported back individually.
 */
export default function PublishModal({ media, defaultCaption = '', onClose, onPosted }) {
  const { t, i18n } = useTranslation();

  const [catalogue, setCatalogue] = useState(null);
  const [selected, setSelected] = useState([]);
  const [caption, setCaption] = useState(defaultCaption);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null); // [{ platform, label, ok, message }]

  // 'compose' -> 'date' -> 'time'
  const [step, setStep] = useState('compose');
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [pickedDate, setPickedDate] = useState('');
  const [pickedTime, setPickedTime] = useState('');

  // Only CONNECTED platforms can receive this post, so only those are offered.
  useEffect(() => {
    let cancelled = false;
    api.get('/api/connect/status')
      .then((data) => {
        if (cancelled) return;
        const all = data.catalogue || [];
        const status = data.status || {};
        const connected = all.filter((p) => status[p.key]?.connected);
        setCatalogue(connected);
        // One connected channel is not a choice — preselect it.
        if (connected.length === 1) setSelected([connected[0].key]);
      })
      .catch(() => { if (!cancelled) setCatalogue([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const toggle = (key) =>
    setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  // Publish (or schedule) to every ticked platform, collecting an individual
  // outcome for each rather than failing the whole batch on the first error.
  const run = async (scheduledTime) => {
    if (!selected.length || busy) return;
    setBusy(true);
    setError('');

    const outcomes = [];
    for (const key of selected) {
      const entry = catalogue.find((p) => p.key === key);
      const label = entry?.label || key;
      const body = {
        platform: metaFor(key).generationKey,
        postText: caption.trim(),
        mediaId: media.id,
      };
      try {
        if (scheduledTime) {
          await api.post('/api/content/schedule', { ...body, scheduledTime });
          outcomes.push({ key, label, ok: true, message: t('publish.scheduled', 'Scheduled') });
        } else {
          const res = await api.post('/api/content/post-now', body);
          outcomes.push({
            key,
            label,
            ok: true,
            message: res.simulated
              ? t('publish.loggedSimulated', 'Logged — live publishing activates with this integration')
              : t('publish.published', 'Published'),
          });
        }
      } catch (err) {
        outcomes.push({ key, label, ok: false, message: err.message || t('common.somethingWentWrong', 'Something went wrong') });
      }
    }

    setResults(outcomes);
    setBusy(false);
    if (outcomes.some((o) => o.ok)) onPosted?.();
  };

  const confirmSchedule = () => {
    if (!pickedDate || !pickedTime) return;
    run(new Date(`${pickedDate}T${pickedTime}`).toISOString());
  };

  const isVideo = media?.kind === 'video';
  const nothingConnected = catalogue && catalogue.length === 0;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return (
    <div
      className="auth-overlay animate-fade-in"
      id="publish_modal"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}
    >
      <div className="auth-card panel text-left publish-card" role="dialog" aria-modal="true" aria-labelledby="publish_modal_title">
        <div className="auth-header flex-between mb-20">
          <h3 id="publish_modal_title">
            {step === 'date'
              ? <><i className="fa-solid fa-calendar-days"></i> {t('publish.pickDate', 'Pick a date')}</>
              : step === 'time'
                ? <><i className="fa-solid fa-clock"></i> {t('publish.pickTime', 'Pick a time')}</>
                : <><i className="fa-solid fa-paper-plane"></i> {t('publish.title', 'Post this media')}</>}
          </h3>
          <button className="btn-close" onClick={onClose} disabled={busy} id="btn_close_publish" aria-label={t('common.close', 'Close')}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {error && <div className="auth-error-box mb-20" role="alert">{error}</div>}

        {/* --- DONE: per-platform outcome --- */}
        {results ? (
          <div className="step-content">
            <ul className="publish-results">
              {results.map((r) => (
                <li key={r.key} className={r.ok ? 'ok' : 'failed'}>
                  <i className={`fa-solid ${r.ok ? 'fa-circle-check' : 'fa-circle-exclamation'}`}></i>
                  <div>
                    <strong>{r.label}</strong>
                    <span>{r.message}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="publish-actions">
              <button className="btn btn-primary" onClick={onClose} id="btn_publish_done">{t('common.done', 'Done')}</button>
            </div>
          </div>
        ) : step === 'date' ? (
          /* --- STEP: date, using the same calendar as the Automations tab --- */
          <div className="step-content">
            <div className="publish-cal-head">
              <CalendarNav cursor={cursor} onStep={(d) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + d, 1))} />
            </div>
            <CalendarGrid
              cursor={cursor}
              selected={pickedDate}
              // A post cannot be scheduled into the past.
              isDisabled={(d) => d < startOfToday}
              onSelect={(key) => { setPickedDate(key); setStep('time'); }}
            />
            <div className="publish-actions">
              <button className="btn btn-secondary" onClick={() => setStep('compose')}>{t('common.back', 'Back')}</button>
            </div>
          </div>
        ) : step === 'time' ? (
          /* --- STEP: time --- */
          <div className="step-content">
            <p className="publish-picked-date">
              {new Date(`${pickedDate}T00:00:00`).toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <input
              type="time"
              className="input-field publish-time-input"
              value={pickedTime}
              onChange={(e) => setPickedTime(e.target.value)}
              id="inp_publish_time"
            />
            <div className="publish-time-presets">
              {TIME_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`picker-chip ${pickedTime === p.value ? 'active' : ''}`}
                  onClick={() => setPickedTime(p.value)}
                >
                  {t(`publish.time.${p.key}`, p.value)}
                </button>
              ))}
            </div>
            <div className="publish-actions">
              <button className="btn btn-secondary" onClick={() => setStep('date')} disabled={busy}>{t('common.back', 'Back')}</button>
              <button
                className="btn btn-accent"
                onClick={confirmSchedule}
                disabled={!pickedTime || busy}
                id="btn_confirm_publish_schedule"
              >
                <i className="fa-solid fa-calendar-check"></i>{' '}
                {busy ? t('publish.scheduling', 'Scheduling…') : t('publish.confirmSchedule', 'Confirm schedule')}
              </button>
            </div>
          </div>
        ) : (
          /* --- STEP: platforms + caption --- */
          <div className="step-content">
            <div className="publish-preview">
              {isVideo
                ? <video src={api.mediaUrl(media.url)} controls className="publish-thumb" />
                : <img src={api.mediaUrl(media.url)} alt={t('publish.previewAlt', 'Media to post')} className="publish-thumb" />}
            </div>

            <label className="form-label">{t('publish.platformsLabel', 'Post to')}</label>
            {catalogue === null ? (
              <div className="text-center" style={{ padding: 20 }}><i className="fa-solid fa-spinner fa-spin text-accent"></i></div>
            ) : nothingConnected ? (
              <p className="text-muted publish-empty">
                <i className="fa-solid fa-circle-info"></i>{' '}
                {t('publish.noneConnected', 'No channels connected yet — connect one in Connections to publish.')}
              </p>
            ) : (
              <div className="publish-platform-list">
                {catalogue.map((p) => {
                  const m = metaFor(p.key);
                  const checked = selected.includes(p.key);
                  return (
                    <label key={p.key} className={`publish-platform ${checked ? 'checked' : ''}`} htmlFor={`chk_publish_${p.key}`}>
                      <input
                        type="checkbox"
                        id={`chk_publish_${p.key}`}
                        checked={checked}
                        onChange={() => toggle(p.key)}
                        disabled={busy}
                      />
                      <i className={m.icon} style={{ color: m.color }}></i>
                      <span>{p.label}</span>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="form-group mt-20">
              <label className="form-label" htmlFor="inp_publish_caption">{t('publish.captionLabel', 'Caption')}</label>
              <textarea
                id="inp_publish_caption"
                className="input-field"
                rows={3}
                maxLength={CAPTION_MAX}
                placeholder={t('publish.captionPh', 'Write a caption… #hashtags welcome')}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                disabled={busy}
              />
            </div>

            <div className="publish-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setStep('date')}
                disabled={!selected.length || busy}
                id="btn_publish_schedule"
              >
                <i className="fa-solid fa-calendar-days"></i> {t('publish.schedule', 'Schedule')}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => run(null)}
                disabled={!selected.length || busy}
                id="btn_publish_now"
              >
                {busy
                  ? <><i className="fa-solid fa-spinner fa-spin"></i> {t('publish.posting', 'Posting…')}</>
                  : <><i className="fa-solid fa-paper-plane"></i> {t('publish.postNow', 'Post Now')}</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
