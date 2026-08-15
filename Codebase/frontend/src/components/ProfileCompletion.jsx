import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';

/**
 * The other half of onboarding.
 *
 * Signup asks the essentials so registration is fast; these are the rest —
 * a fixed set every business needs, plus 2-5 written for THIS business by
 * Gemini (backend/profileQuestions.js). Nothing here is required: every
 * question can be skipped, and skipping stops it being asked again.
 *
 * `onCountChange` reports the remaining count up to the Dashboard, which draws
 * the "!" on the profile icon.
 */
export default function ProfileCompletion({ onCountChange, onProfileUpdate }) {
  const { t } = useTranslation();

  const [state, setState] = useState({ loading: true, error: '', questions: [], pendingCount: 0, engine: null });
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAnswered, setShowAnswered] = useState(false);

  const load = async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = await api.get('/api/profile/completion');
      setState({
        loading: false,
        error: '',
        questions: data.questions || [],
        pendingCount: data.pendingCount || 0,
        engine: data.engine || null,
      });
      setDrafts({});
      onCountChange?.(data.pendingCount || 0);
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message || 'Could not load your questions.' }));
    }
  };

  // Runs once per mount; the question set is cached server-side, so reopening
  // the panel shows the same list rather than a freshly invented one.
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The fixed set is the same for everyone, so it is translated here. The
  // AI-written half cannot be — it is generated per business, in English — and
  // falls through to the server's own wording.
  const label = (q) => (q.fixed ? t(`profileQuestions.fixed.${q.key}.label`, q.label) : q.label);
  const hint = (q) => (q.fixed ? t(`profileQuestions.fixed.${q.key}.hint`, q.hint) : q.hint);
  const placeholder = (q) => (q.fixed ? t(`profileQuestions.fixed.${q.key}.placeholder`, q.placeholder) : q.placeholder);

  const valueOf = (q) => (drafts[q.key] !== undefined ? drafts[q.key] : q.value);
  const setDraft = (key, value) => {
    setSaved(false);
    setDrafts((d) => ({ ...d, [key]: value }));
  };

  /** Send `answers` (or every edited draft). An empty string is an explicit skip. */
  const submit = async (answers) => {
    const payload = answers || Object.fromEntries(
      Object.entries(drafts).filter(([key, v]) => {
        const q = state.questions.find((x) => x.key === key);
        return q && String(v).trim() !== String(q.value || '').trim();
      })
    );
    if (!Object.keys(payload).length) return;

    setBusy(true);
    try {
      const data = await api.post('/api/profile/answers', { answers: payload });
      setState((s) => ({ ...s, questions: data.questions || s.questions, pendingCount: data.pendingCount || 0 }));
      setDrafts({});
      setSaved(true);
      onCountChange?.(data.pendingCount || 0);
      if (data.profile) onProfileUpdate?.(data.profile);
    } catch (err) {
      setState((s) => ({ ...s, error: err.message || 'Could not save your answers.' }));
    }
    setBusy(false);
  };

  const renderInput = (q) => {
    const value = valueOf(q);
    // Multi-select is stored as a comma-separated string of option codes, and
    // the ORDER is the answer: it decides which language a caption leads with.
    // Clicking appends, so the sequence is whatever the owner picked.
    if (q.type === 'multiselect' && Array.isArray(q.options)) {
      const picked = String(value).split(',').map((s) => s.trim()).filter(Boolean);
      const toggle = (opt) => setDraft(
        q.key,
        (picked.includes(opt) ? picked.filter((p) => p !== opt) : [...picked, opt]).join(', ')
      );
      return (
        <div className="multiselect-row">
          {q.options.map((opt) => {
            const at = picked.indexOf(opt);
            return (
              <button
                type="button"
                key={opt}
                className={`multiselect-chip ${at > -1 ? 'active' : ''}`}
                onClick={() => toggle(opt)}
                id={`pq_${q.key}_${opt}`}
                aria-pressed={at > -1}
              >
                {at > -1 && <span className="multiselect-order">{at + 1}</span>}
                {t(`profileQuestions.langs.${opt}`, opt.toUpperCase())}
              </button>
            );
          })}
        </div>
      );
    }
    if (q.type === 'select' && Array.isArray(q.options)) {
      return (
        <select
          id={`pq_${q.key}`}
          className="select-field"
          value={value}
          onChange={(e) => setDraft(q.key, e.target.value)}
        >
          <option value="">{t('profileQuestions.choose', 'Choose one…')}</option>
          {q.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    }
    if (q.type === 'textarea') {
      return (
        <textarea
          id={`pq_${q.key}`}
          className="input-field settings-textarea"
          rows={3}
          value={value}
          placeholder={placeholder(q)}
          onChange={(e) => setDraft(q.key, e.target.value)}
        />
      );
    }
    return (
      <input
        id={`pq_${q.key}`}
        className="input-field"
        value={value}
        placeholder={placeholder(q)}
        onChange={(e) => setDraft(q.key, e.target.value)}
      />
    );
  };

  if (state.loading) {
    return (
      <section className="settings-section glass-card">
        <p className="settings-hint"><i className="fa-solid fa-spinner fa-spin"></i> {t('profileQuestions.loading', 'Loading your questions…')}</p>
      </section>
    );
  }

  if (state.error && !state.questions.length) {
    return (
      <section className="settings-section glass-card">
        <p className="settings-notice err">
          <i className="fa-solid fa-triangle-exclamation"></i> {state.error}
        </p>
        <button className="btn btn-secondary btn-sm" onClick={load} id="btn_retry_completion">
          {t('common.tryAgain', 'Try again')}
        </button>
      </section>
    );
  }

  const pending = state.questions.filter((q) => !q.answered);
  const answered = state.questions.filter((q) => q.answered);
  const dirty = Object.keys(drafts).length > 0;

  return (
    <section className="settings-section glass-card profile-completion" id="profile_completion">
      <div className="completion-head">
        <h3 className="completion-title">
          {t('profileQuestions.title', 'Complete your business profile')}
          {state.pendingCount > 0 && <span className="completion-count">{state.pendingCount}</span>}
        </h3>
        <p className="settings-hint">
          {state.pendingCount > 0
            ? t('profileQuestions.hint', 'We kept signup short. These are the details that make what Markivo writes yours instead of generic — answer any, skip the rest.')
            : t('profileQuestions.done', 'Nothing left to answer. You can still edit anything below.')}
        </p>
        {state.engine === 'template' && (
          <p className="settings-hint completion-source">
            <i className="fa-solid fa-circle-info"></i>{' '}
            {t('profileQuestions.templateNote', 'These are standard questions for your category — the AI-personalised set needs a Gemini key.')}
          </p>
        )}
      </div>

      {pending.map((q) => (
        <div className="form-group completion-question" key={q.key}>
          <label className="form-label" htmlFor={`pq_${q.key}`}>{label(q)}</label>
          {q.hint && <small className="completion-hint">{hint(q)}</small>}
          {renderInput(q)}
          <button
            type="button"
            className="btn-link completion-skip"
            onClick={() => submit({ [q.key]: '' })}
            disabled={busy}
            id={`btn_skip_${q.key}`}
          >
            {t('profileQuestions.skip', "Skip — I'd rather not say")}
          </button>
        </div>
      ))}

      {answered.length > 0 && (
        <>
          <button
            type="button"
            className="btn-link completion-toggle"
            onClick={() => setShowAnswered((v) => !v)}
            id="btn_toggle_answered"
          >
            <i className={`fa-solid ${showAnswered ? 'fa-chevron-down' : 'fa-chevron-right'}`}></i>{' '}
            {t('profileQuestions.answeredToggle', 'Already answered ({{count}})', { count: answered.length })}
          </button>
          {showAnswered && answered.map((q) => (
            <div className="form-group completion-question is-answered" key={q.key}>
              <label className="form-label" htmlFor={`pq_${q.key}`}>
                {label(q)}
                {q.answeredBy === 'markiv' && (
                  <span className="completion-badge-src" title={t('profileQuestions.fromMarkiv', 'You told Markiv this in chat')}>
                    <i className="fa-solid fa-comment-dots"></i>
                  </span>
                )}
              </label>
              {q.hint && <small className="completion-hint">{hint(q)}</small>}
              {renderInput(q)}
            </div>
          ))}
        </>
      )}

      <div className="completion-actions">
        <button className="btn btn-primary" onClick={() => submit()} disabled={busy || !dirty} id="btn_save_answers">
          {busy ? t('settings.saving', 'Saving…') : t('profileQuestions.save', 'Save answers')}
        </button>
        {saved && !dirty && (
          <span className="completion-saved"><i className="fa-solid fa-circle-check"></i> {t('profileQuestions.savedShort', 'Saved!')}</span>
        )}
      </div>
    </section>
  );
}
