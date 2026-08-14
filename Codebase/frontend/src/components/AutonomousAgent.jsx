import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import AutomationCalendar from './AutomationCalendar';
import './AutonomousAgent.css';

// Icon + label per activity kind logged by the Autopilot worker.
const KIND_META = {
  analysis: { icon: 'fa-brain', key: 'analysis', fallback: 'Analyzed your business' },
  post_published: { icon: 'fa-paper-plane', key: 'post_published', fallback: 'Published' },
  post_scheduled: { icon: 'fa-clock', key: 'post_scheduled', fallback: 'Scheduled' },
  approval_created: { icon: 'fa-circle-check', key: 'approval_created', fallback: 'Queued for your approval' },
  skipped: { icon: 'fa-circle-pause', key: 'skipped', fallback: 'Paused' },
  error: { icon: 'fa-triangle-exclamation', key: 'error', fallback: 'Error' },
  external_content: { icon: 'fa-database', key: 'external_content', fallback: 'Grounded in real content' },
  context_needed: { icon: 'fa-circle-question', key: 'context_needed', fallback: 'Needs more context' },
  context_answered: { icon: 'fa-comment-dots', key: 'context_answered', fallback: 'You answered Autopilot' },
};

const FREQUENCIES = ['daily', 'weekly', 'test'];

export default function AutonomousAgent({ activeProfile }) {
  const { t } = useTranslation();

  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [catalogue, setCatalogue] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);

  // Persisted config vs. the working form (so "Run now" uses the saved state).
  const [saved, setSaved] = useState({ enabled: false, platforms: [], frequency: 'daily', autoPublish: true });
  const [form, setForm] = useState({ enabled: false, platforms: [], frequency: 'daily', autoPublish: true });

  // Autopilot's open "I need more context" question, if it paused on one.
  const [contextRequest, setContextRequest] = useState(null);
  const [contextAnswer, setContextAnswer] = useState('');
  const [answering, setAnswering] = useState(false);

  // Load the current config + connectable channels + activity on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [status, connect, ctx] = await Promise.all([
          api.get('/api/autonomous/status'),
          api.get('/api/connect/status').catch(() => ({ catalogue: [] })),
          api.get('/api/autonomous/context-request').catch(() => ({ request: null })),
        ]);
        if (cancelled) return;
        setLoadError('');
        setFeatureEnabled(status.enabled !== false);
        setCatalogue(connect.catalogue || []);
        setActivity(status.activity || []);
        setContextRequest(ctx.request || null);
        const cfg = {
          enabled: !!status.config?.enabled,
          platforms: (status.config?.platforms || []).slice().sort(),
          frequency: FREQUENCIES.includes(status.config?.frequency) ? status.config.frequency : 'daily',
          autoPublish: status.config?.autoPublish !== false,
        };
        setSaved(cfg);
        setForm(cfg);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || t('autopilot.loadError', "Couldn't load Autopilot."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeProfile?.id, t]);

  const dirty = JSON.stringify(saved) !== JSON.stringify(form);

  const togglePlatform = (key) => {
    setForm((f) => {
      const platforms = f.platforms.includes(key) ? f.platforms.filter((p) => p !== key) : [...f.platforms, key];
      return { ...f, platforms: platforms.sort() }; // keep sorted so the dirty check is order-insensitive
    });
  };

  const save = async (override) => {
    const payload = { ...form, ...override };
    setSaving(true);
    setNotice('');
    setNoticeError(false);
    try {
      const { config } = await api.put('/api/autonomous/config', payload);
      const cfg = {
        enabled: !!config.enabled,
        platforms: (config.platforms || []).slice().sort(),
        frequency: config.frequency || 'daily',
        autoPublish: config.autoPublish !== false,
      };
      setSaved(cfg);
      setForm(cfg);
      setNotice(t('autopilot.saved', 'Settings saved.'));
    } catch (err) {
      setNotice(err.message || t('autopilot.saveError', "Couldn't save."));
      setNoticeError(true);
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    setNotice('');
    setNoticeError(false);
    try {
      const { activity: fresh, result } = await api.post('/api/autonomous/run', {});
      if (fresh) setActivity(fresh);

      // The run may have stopped on the context gate rather than posting —
      // surface the question straight away instead of a misleading success note.
      if (result && result.paused === 'needs-context') {
        const ctx = await api.get('/api/autonomous/context-request').catch(() => ({ request: null }));
        setContextRequest(ctx.request || null);
        setNotice(t('autopilot.context.paused', 'Autopilot needs a bit more context before it can post.'));
      } else {
        setNotice(t('autopilot.ranNow', 'Autopilot ran — see the activity below.'));
      }
    } catch (err) {
      setNotice(err.message || t('autopilot.runError', "Couldn't run Autopilot."));
      setNoticeError(true);
    } finally {
      setRunning(false);
    }
  };

  // Answer the open context question. This is what unblocks a paused Autopilot.
  const answerContext = async () => {
    const answer = contextAnswer.trim();
    if (!answer || answering) return;
    setAnswering(true);
    setNotice('');
    setNoticeError(false);
    try {
      await api.post('/api/autonomous/context-request/answer', { answer, requestId: contextRequest?.id });
      setContextRequest(null);
      setContextAnswer('');
      setNotice(t('autopilot.context.thanks', 'Thanks — Autopilot will use that on its next run.'));
      const fresh = await api.get('/api/autonomous/activity').catch(() => null);
      if (fresh?.activity) setActivity(fresh.activity);
    } catch (err) {
      setNotice(err.message || t('autopilot.context.answerError', "Couldn't save your answer."));
      setNoticeError(true);
    } finally {
      setAnswering(false);
    }
  };

  if (loading) {
    return (
      <div className="autopilot-pane">
        <div className="ap-loading"><i className="fa-solid fa-spinner fa-spin"></i> {t('common.loading', 'Loading…')}</div>
      </div>
    );
  }

  if (!featureEnabled) {
    return (
      <div className="autopilot-pane">
        <div className="glass-card ap-notice-card">
          <i className="fa-solid fa-robot ap-hero-icon"></i>
          <h2>{t('autopilot.title', 'Autopilot')}</h2>
          <p className="text-muted">{t('autopilot.disabledNotice', 'Autopilot is not enabled in this deployment.')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="autopilot-pane animate-fade-in">
      <div className="ap-header">
        <div>
          <h2><i className="fa-solid fa-robot"></i> {t('autopilot.title', 'Autopilot')}</h2>
          <p className="subtitle">{t('autopilot.subtitle', 'Let Markiv analyze your business and post promotional content to your channels on its own.')}</p>
        </div>
      </div>

      {loadError && <div className="ap-error">{loadError}</div>}

      {/* CONTEXT GATE — Autopilot stopped rather than publish a generic ad.
          First thing the owner sees, because nothing else runs until it clears. */}
      {contextRequest && (
        <div className="glass-card ap-context-banner" role="status">
          <div className="ap-context-head">
            <i className="fa-solid fa-circle-question ap-context-icon"></i>
            <div>
              <h4>{t('autopilot.context.title', 'Autopilot paused — it needs a bit more context')}</h4>
              <p className="text-muted">
                {contextRequest.rationale
                  || t('autopilot.context.blurb', "Markiv doesn't know enough about your channel yet to write something worth posting, so it stopped instead of publishing a generic ad.")}
              </p>
            </div>
          </div>

          {contextRequest.questions?.length > 0 && (
            <ul className="ap-context-questions">
              {contextRequest.questions.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          )}

          <label className="form-label" htmlFor="inp_ap_context">{t('autopilot.context.answerLabel', 'Your answer')}</label>
          <textarea
            id="inp_ap_context"
            className="input-field ap-context-input"
            rows={3}
            value={contextAnswer}
            onChange={(e) => setContextAnswer(e.target.value)}
            maxLength={2000}
            disabled={answering}
            placeholder={t('autopilot.context.answerPh', 'e.g. We want more weekday-morning customers — a discount post that gets people to walk in before 11am.')}
          />

          <div className="ap-context-actions">
            <button
              className="btn btn-primary"
              id="btn_ap_context_answer"
              onClick={answerContext}
              disabled={answering || !contextAnswer.trim()}
            >
              {answering ? t('autopilot.context.sending', 'Sending…') : t('autopilot.context.send', 'Send to Autopilot')}
            </button>
            <span className="ap-context-hint">{t('autopilot.context.hint', 'Autopilot remembers this — you only answer once.')}</span>
          </div>
        </div>
      )}

      {/* MASTER ENABLE */}
      <div className="glass-card ap-toggle-card">
        <div>
          <h4>{t('autopilot.enableLabel', 'Enable Autopilot')}</h4>
          <p className="text-muted">{t('autopilot.enableHint', 'When on, Markiv runs on a schedule — analyzing, generating, and posting for you.')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.enabled}
          id="btn_autopilot_enable"
          className={`ap-switch ${form.enabled ? 'on' : ''}`}
          onClick={() => save({ enabled: !form.enabled })}
          disabled={saving}
        >
          <span className="ap-switch-knob"></span>
        </button>
      </div>

      {/* CONFIG */}
      <div className={`ap-config ${form.enabled ? '' : 'ap-config-muted'}`}>
        <div className="glass-card ap-section">
          <label className="form-label">{t('autopilot.platformsLabel', 'Channels to post to')}</label>
          <p className="text-muted ap-hint">{t('autopilot.platformsHint', 'Autopilot posts to the channels you pick (connected channels post for real; others are simulated until connected).')}</p>
          <div className="ap-platform-grid">
            {catalogue.map((p) => (
              <button
                type="button"
                key={p.key}
                id={`btn_ap_platform_${p.key}`}
                className={`ap-platform-chip ${form.platforms.includes(p.key) ? 'selected' : ''}`}
                onClick={() => togglePlatform(p.key)}
                disabled={!form.enabled}
              >
                <i className={`fa-solid ${form.platforms.includes(p.key) ? 'fa-square-check' : 'fa-square'}`}></i> {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="glass-card ap-section">
          <label className="form-label" htmlFor="sel_ap_frequency">{t('autopilot.frequencyLabel', 'How often')}</label>
          <select
            id="sel_ap_frequency"
            className="select-field"
            value={form.frequency}
            onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}
            disabled={!form.enabled}
          >
            <option value="daily">{t('autopilot.freq.daily', 'Once a day')}</option>
            <option value="weekly">{t('autopilot.freq.weekly', 'Once a week')}</option>
            <option value="test">{t('autopilot.freq.test', 'Every minute (demo)')}</option>
          </select>
        </div>

        <div className="glass-card ap-section">
          <label className="form-label">{t('autopilot.publishModeLabel', 'When a post is ready')}</label>
          <div className="ap-radio-row">
            <button
              type="button"
              className={`ap-radio ${form.autoPublish ? 'selected' : ''}`}
              onClick={() => setForm((f) => ({ ...f, autoPublish: true }))}
              disabled={!form.enabled}
              id="btn_ap_autopublish"
            >
              <i className="fa-solid fa-bolt"></i>
              <span className="ap-radio-title">{t('autopilot.autoPublish', 'Publish it automatically')}</span>
              <span className="ap-radio-hint">{t('autopilot.autoPublishHint', 'Markiv posts without asking.')}</span>
            </button>
            <button
              type="button"
              className={`ap-radio ${!form.autoPublish ? 'selected' : ''}`}
              onClick={() => setForm((f) => ({ ...f, autoPublish: false }))}
              disabled={!form.enabled}
              id="btn_ap_queue"
            >
              <i className="fa-solid fa-user-check"></i>
              <span className="ap-radio-title">{t('autopilot.queueMode', 'Queue for my approval')}</span>
              <span className="ap-radio-hint">{t('autopilot.queueModeHint', 'You approve each post before it goes out.')}</span>
            </button>
          </div>
        </div>

        <div className="ap-actions">
          <button className="btn btn-primary" id="btn_ap_save" onClick={() => save()} disabled={saving || !dirty}>
            {saving ? t('autopilot.saving', 'Saving…') : t('autopilot.save', 'Save settings')}
          </button>
          <button
            className="btn btn-accent"
            id="btn_ap_run_now"
            onClick={runNow}
            disabled={running || !saved.enabled || dirty}
            title={dirty ? t('autopilot.runNeedsSave', 'Save your changes first') : ''}
          >
            {running
              ? (<><i className="fa-solid fa-spinner fa-spin"></i> {t('autopilot.running', 'Running…')}</>)
              : (<><i className="fa-solid fa-play"></i> {t('autopilot.runNow', 'Run now')}</>)}
          </button>
          {notice && <span className={`ap-notice ${noticeError ? 'ap-notice-error' : ''}`}>{notice}</span>}
        </div>

        <p className="ap-safety">
          <i className="fa-solid fa-shield-halved"></i>{' '}
          {t('autopilot.adSafetyNote', 'Autopilot only creates free organic posts. Paid ad campaigns always need your explicit approval — Markiv never spends your money on its own.')}
        </p>
      </div>

      {/* SCHEDULE — everything queued or already done, on one timeline */}
      <div className="glass-card ap-section">
        <AutomationCalendar activeProfile={activeProfile} />
      </div>

      {/* ACTIVITY LOG */}
      <div className="ap-activity">
        <h3>{t('autopilot.activityTitle', 'Activity')}</h3>
        {activity.length === 0 ? (
          <p className="text-muted">{t('autopilot.noActivity', 'Nothing yet. Turn Autopilot on (or press “Run now”) and its actions will show up here.')}</p>
        ) : (
          <ul className="ap-activity-list">
            {activity.map((a) => {
              const m = KIND_META[a.kind] || { icon: 'fa-circle-info', key: a.kind, fallback: a.kind };
              return (
                <li key={a.id} className={`ap-activity-item glass-card kind-${a.kind}`}>
                  <i className={`fa-solid ${m.icon} ap-activity-icon`}></i>
                  <div className="ap-activity-body">
                    <span className="ap-activity-kind">{t(`autopilot.kind.${m.key}`, m.fallback)}</span>
                    {a.summary && <span className="ap-activity-summary">{a.summary}</span>}
                    {a.kind === 'external_content' && a.payload && (
                      <ul className="ap-grounding-list">
                        {(a.payload.ownExternalActivity || []).map((s, i) => (
                          <li key={`own-${i}`}><i className="fa-solid fa-user"></i> {s}</li>
                        ))}
                        {(a.payload.competitorHighlights || []).map((s, i) => (
                          <li key={`comp-${i}`}><i className="fa-solid fa-magnifying-glass"></i> {s}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <time className="ap-activity-time">{new Date(a.created_at).toLocaleString()}</time>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
