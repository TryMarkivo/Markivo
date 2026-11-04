import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import './AutonomousAgent.css';
import InfoTip from './ui/InfoTip';
import BriefForm from './autopilot/BriefForm';
import ScheduleEditor from './autopilot/ScheduleEditor';
import { slotWhen } from '../lib/dates';

// Icon + label per activity kind logged by the Autopilot worker.
const KIND_META = {
  analysis: { icon: 'fa-brain', key: 'analysis', fallback: 'Planned a post' },
  post_published: { icon: 'fa-paper-plane', key: 'post_published', fallback: 'Published' },
  post_scheduled: { icon: 'fa-clock', key: 'post_scheduled', fallback: 'Scheduled' },
  approval_created: { icon: 'fa-circle-check', key: 'approval_created', fallback: 'Waiting for your OK' },
  skipped: { icon: 'fa-circle-pause', key: 'skipped', fallback: 'Paused' },
  error: { icon: 'fa-triangle-exclamation', key: 'error', fallback: 'Error' },
  external_content: { icon: 'fa-database', key: 'external_content', fallback: 'Grounded in real content' },
  context_needed: { icon: 'fa-circle-question', key: 'context_needed', fallback: 'Asked you a few questions' },
  context_answered: { icon: 'fa-comment-dots', key: 'context_answered', fallback: 'You answered Autopilot' },
};

const AUTO = 'auto';
const BRIEF_KEYS = ['themes', 'goal', 'tone', 'length', 'emoji', 'cta', 'avoid', 'news'];
const DEFAULT_SCHEDULE = { mode: 'smart', postsPerWeek: 3, days: [], times: [], timezone: 'Asia/Tashkent' };

const configFrom = (status) => ({
  enabled: !!status.config?.enabled,
  platforms: (status.config?.platforms || []).slice().sort(),
  autoPublish: status.config?.autoPublish !== false,
  demo: status.config?.frequency === 'test',
  schedule: status.plan?.schedule || DEFAULT_SCHEDULE,
});

const briefValues = (brief) => {
  const out = {};
  for (const k of BRIEF_KEYS) if (brief && brief[k] !== undefined) out[k] = brief[k];
  return out;
};

export default function AutonomousAgent({ activeProfile, onGoToCalendar }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [catalogue, setCatalogue] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [relearning, setRelearning] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);

  // Persisted config vs. the working form (so "Run now" uses the saved state).
  const [saved, setSaved] = useState(configFrom({}));
  const [form, setForm] = useState(configFrom({}));
  // Only a schedule the owner actually touched (or saved before) is sent:
  // otherwise Autopilot still asks a brand-new channel when to post.
  const [scheduleTouched, setScheduleTouched] = useState(false);

  // Autopilot's open questions, if it paused to ask.
  const [answers, setAnswers] = useState({});
  const [freeText, setFreeText] = useState('');
  const [answering, setAnswering] = useState(false);

  // The brief, editable any time.
  const [briefForm, setBriefForm] = useState({});
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefSaving, setBriefSaving] = useState(false);
  const [newsDraft, setNewsDraft] = useState('');

  const [pendingApprovals, setPendingApprovals] = useState([]);

  const say = (msg, isError = false) => { setNotice(msg); setNoticeError(isError); };

  const applyStatus = useCallback((s) => {
    setStatus(s);
    setFeatureEnabled(s.enabled !== false);
    const cfg = configFrom(s);
    setSaved(cfg);
    setForm(cfg);
    setScheduleTouched(!!s.plan?.chosen);
    setBriefForm(briefValues(s.brief));
    // Default the "when" question to the plan in force.
    setAnswers((a) => (a.schedule === undefined && s.contextRequest?.questions?.some((q) => q.id === 'schedule')
      ? { ...a, schedule: s.plan?.schedule || DEFAULT_SCHEDULE } : a));
  }, []);

  const reload = useCallback(async () => {
    const [s, approvals] = await Promise.all([
      api.get('/api/autonomous/status'),
      api.get('/api/autonomous/approvals').catch(() => ({ approvals: [] })),
    ]);
    applyStatus(s);
    setPendingApprovals(approvals.approvals || []);
    return s;
  }, [applyStatus]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, connect, approvals] = await Promise.all([
          api.get('/api/autonomous/status'),
          api.get('/api/connect/status').catch(() => ({ catalogue: [] })),
          api.get('/api/autonomous/approvals').catch(() => ({ approvals: [] })),
        ]);
        if (cancelled) return;
        setLoadError('');
        // Channels that are "coming soon" here can't publish, so Autopilot
        // doesn't offer them.
        setCatalogue((connect.catalogue || []).filter((p) => !connect.status?.[p.key]?.comingSoon));
        applyStatus(s);
        setPendingApprovals(approvals.approvals || []);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || t('autopilot.loadError', "Couldn't load Autopilot."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeProfile?.id, t, applyStatus]);

  const dirty = JSON.stringify(saved) !== JSON.stringify(form);

  const togglePlatform = (key) => {
    setForm((f) => {
      const platforms = f.platforms.includes(key) ? f.platforms.filter((p) => p !== key) : [...f.platforms, key];
      return { ...f, platforms: platforms.sort() }; // keep sorted so the dirty check is order-insensitive
    });
  };

  const save = async (override) => {
    const next = { ...form, ...override };
    setSaving(true);
    say('');
    try {
      const payload = {
        enabled: next.enabled,
        platforms: next.platforms,
        autoPublish: next.autoPublish,
        frequency: next.demo ? 'test' : 'scheduled',
      };
      if (scheduleTouched) payload.schedule = next.schedule;
      await api.put('/api/autonomous/config', payload);
      await reload();
      say(t('autopilot.saved', 'Settings saved.'));
    } catch (err) {
      say(err.message || t('autopilot.saveError', "Couldn't save."), true);
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    say('');
    try {
      const { result } = await api.post('/api/autonomous/run', {});
      await reload();
      // The run may have stopped to ask rather than post — say so.
      say(result && result.paused === 'needs-context'
        ? t('autopilot.context.paused', 'Autopilot needs a few answers before it can post.')
        : t('autopilot.ranNow', 'Autopilot ran — see the activity below.'));
    } catch (err) {
      say(err.message || t('autopilot.runError', "Couldn't run Autopilot."), true);
    } finally {
      setRunning(false);
    }
  };

  const request = status?.contextRequest || null;
  const briefQuestions = (request?.questions || []).filter((q) => q && typeof q === 'object' && q.id);
  const freeQuestions = (request?.questions || []).filter((q) => typeof q === 'string');

  // Answer the open questions. Anything left blank: Autopilot decides.
  const sendAnswers = async () => {
    if (answering) return;
    if (freeQuestions.length && !briefQuestions.length && !freeText.trim()) return;
    setAnswering(true);
    say('');
    try {
      const body = { requestId: request.id };
      if (briefQuestions.length) body.answers = answers;
      if (freeText.trim()) body.answer = freeText.trim();
      await api.post('/api/autonomous/context-request/answer', body);
      setAnswers({});
      setFreeText('');
      await reload();
      say(t('autopilot.context.thanks', 'Thanks — Autopilot will use that from its next post on.'));
    } catch (err) {
      say(err.message || t('autopilot.context.answerError', "Couldn't save your answers."), true);
    } finally {
      setAnswering(false);
    }
  };

  const saveBrief = async (patch) => {
    setBriefSaving(true);
    say('');
    try {
      const { brief } = await api.put('/api/autonomous/brief', { answers: patch });
      setBriefForm(briefValues(brief));
      await reload();
      say(t('autopilot.brief.saved', 'Saved. Autopilot follows it from the next post.'));
      return true;
    } catch (err) {
      say(err.message || t('autopilot.saveError', "Couldn't save."), true);
      return false;
    } finally {
      setBriefSaving(false);
    }
  };

  const relearn = async () => {
    setRelearning(true);
    say('');
    try {
      await api.post('/api/autonomous/style/relearn', {});
      await reload();
      say(t('autopilot.learned.done', 'Autopilot read your channel again.'));
    } catch (err) {
      say(err.message || t('autopilot.saveError', "Couldn't save."), true);
    } finally {
      setRelearning(false);
    }
  };

  // --- Formatting -----------------------------------------------------------
  const tz = status?.plan?.schedule?.timezone || 'Asia/Tashkent';
  const when = (iso) => slotWhen(iso, lang, tz);
  const themeLabel = (theme) => {
    if (!theme) return '';
    if (theme.key === 'news') return t('autopilot.theme.news', 'Your news');
    return t(`autopilot.q.themes.opt.${theme.key}`, theme.name);
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

  const plan = status?.plan;
  const style = status?.style;
  const bot = status?.telegramBot;
  const next = plan?.upcoming?.[0];
  const activity = status?.activity || [];

  // One line that says what Autopilot is doing right now.
  let statusLine;
  let statusTone = 'idle';
  if (!saved.enabled) statusLine = t('autopilot.status.off', 'Autopilot is off. Turn it on and it starts with your channel.');
  else if (request) { statusLine = t('autopilot.status.asking', 'Paused: answer a few questions below and Autopilot starts.'); statusTone = 'warn'; }
  else if (plan?.demo) { statusLine = t('autopilot.status.demo', 'Demo mode: Autopilot posts every minute.'); statusTone = 'on'; }
  else if (next) {
    statusLine = t('autopilot.status.next', { when: when(next.at), topic: themeLabel(next.theme), defaultValue: 'Next post: {{when}} — {{topic}}' });
    statusTone = 'on';
  }

  const schedHint = form.autoPublish
    ? t('autopilot.plan.autoHint', { hours: plan?.leadHours || 1, defaultValue: 'Autopilot writes each post {{hours}} hour before it goes out. It waits on the Calendar, where you can still edit or delete it.' })
    : t('autopilot.plan.approvalHint', { hours: plan?.leadHours || 12, defaultValue: 'Autopilot writes each post {{hours}} hours ahead and asks for your OK. Approve it before its time and it goes out on time.' });

  return (
    <div className="autopilot-pane animate-fade-in">
      <header className="page-head">
        <div>
          <h1>{t('autopilot.title', 'Autopilot')}<InfoTip text={t('autopilot.subtitle', 'Autopilot learns how your channel writes and posts for you on a schedule — about your business, in your style.')} /></h1>
        </div>
      </header>

      {loadError && <div className="ap-error">{loadError}</div>}

      {statusLine && (
        <div className={`ap-status ap-status-${statusTone}`} role="status" id="ap_status_line">
          <span className="ap-status-dot" aria-hidden="true"></span>
          <span>{statusLine}</span>
        </div>
      )}

      {/* QUESTIONS — Autopilot stopped rather than guess. First thing the
          owner sees, because nothing is written until it clears. */}
      {request && (
        <section className="glass-card ap-context-banner" aria-labelledby="ap_q_title">
          <div className="ap-context-head">
            <i className="fa-solid fa-circle-question ap-context-icon"></i>
            <div>
              <h4 id="ap_q_title">{t('autopilot.context.title', 'Before Autopilot starts: a few quick questions')}</h4>
              <p className="text-muted">
                {request.rationale
                  || t('autopilot.context.blurb', "Autopilot doesn't know enough about your channel yet to write something worth posting, so it asks instead of guessing.")}
              </p>
            </div>
          </div>

          {briefQuestions.length > 0 && (
            <BriefForm
              questions={briefQuestions}
              values={answers}
              onChange={(id, val) => setAnswers((a) => ({ ...a, [id]: val }))}
              disabled={answering}
              best={plan?.best}
              idPrefix="apq"
            />
          )}

          {freeQuestions.length > 0 && (
            <>
              <ul className="ap-context-questions">
                {freeQuestions.map((q, i) => <li key={i}>{q}</li>)}
              </ul>
              <label className="ui-label" htmlFor="inp_ap_context">{t('autopilot.context.answerLabel', 'Your answer')}</label>
              <textarea
                id="inp_ap_context"
                className="ui-textarea ap-context-input"
                rows={3}
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                maxLength={2000}
                disabled={answering}
                placeholder={t('autopilot.context.answerPh', 'e.g. We want more weekday-morning customers — a discount post that gets people to walk in before 11am.')}
              />
            </>
          )}

          <div className="ap-context-actions">
            <button
              className="ui-btn ui-btn-primary"
              id="btn_ap_context_answer"
              onClick={sendAnswers}
              disabled={answering || (freeQuestions.length > 0 && !briefQuestions.length && !freeText.trim())}
            >
              {answering ? t('autopilot.context.sending', 'Sending…') : t('autopilot.context.send', 'Send to Autopilot')}
            </button>
            <span className="ap-context-hint">
              {briefQuestions.length
                ? t('autopilot.context.skipHint', 'Skip anything you like: Autopilot decides those itself. You can change every answer later.')
                : t('autopilot.context.hint', 'Autopilot remembers this — you only answer once.')}
            </span>
          </div>
        </section>
      )}

      {/* SETTINGS — one card: the switch, then each setting as a row. */}
      <div className="glass-card ap-toggle-card">
        <div>
          <h4>{t('autopilot.enableLabel', 'Enable Autopilot')}<InfoTip text={t('autopilot.enableHint', 'When on, Autopilot posts on your schedule: it picks a topic, writes in your style and publishes or asks for your OK.')} /></h4>
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

      <div className={`ap-config ${form.enabled ? '' : 'ap-config-muted'}`}>
        <div className="glass-card ap-section">
          <span className="form-label">
            {t('autopilot.platformsLabel', 'Channels to post to')}
            <InfoTip text={t('autopilot.platformsHint', 'Autopilot posts to the channels you pick (connected channels post for real; others are simulated until connected).')} />
          </span>
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
          <span className="form-label">{t('autopilot.frequencyLabel', 'When to post')}</span>
          <ScheduleEditor
            value={form.schedule}
            onChange={(s) => { setScheduleTouched(true); setForm((f) => ({ ...f, schedule: s, demo: false })); }}
            disabled={!form.enabled}
            best={style?.timing || plan?.best}
            idPrefix="ap_cfg"
          />
          {(import.meta.env.DEV || form.demo) && (
            <label className="ap-demo-toggle">
              <input type="checkbox" checked={form.demo} disabled={!form.enabled} onChange={(e) => setForm((f) => ({ ...f, demo: e.target.checked }))} />
              {' '}{t('autopilot.freq.test', 'Every minute (demo)')}
            </label>
          )}
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
              <span className="ap-radio-hint">{t('autopilot.autoPublishHint', 'It goes out at its time. Until then you can edit it on the Calendar.')}</span>
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
              <span className="ap-radio-hint">
                {bot
                  ? t('autopilot.queueModeHintTg', { bot: bot.username, defaultValue: 'You approve each post first — here, or in Telegram with one tap (@{{bot}} sends it to you).' })
                  : t('autopilot.queueModeHint', 'You approve each post before it goes out.')}
              </span>
            </button>
          </div>
        </div>

        <div className="ap-actions">
          <button className="ui-btn ui-btn-primary" id="btn_ap_save" onClick={() => save()} disabled={saving || !dirty}>
            {saving ? t('autopilot.saving', 'Saving…') : t('autopilot.save', 'Save settings')}
          </button>
          <button
            className="ui-btn ui-btn-outline"
            id="btn_ap_run_now"
            onClick={runNow}
            disabled={running || !saved.enabled || dirty}
            title={dirty ? t('autopilot.runNeedsSave', 'Save your changes first') : t('autopilot.runNowHint', 'Write and send one post right now, outside the plan')}
          >
            {running
              ? (<><i className="fa-solid fa-spinner fa-spin"></i> {t('autopilot.running', 'Running…')}</>)
              : (<><i className="fa-solid fa-play"></i> {t('autopilot.runNow', 'Post one now')}</>)}
          </button>
          {notice && <span className={`ap-notice ${noticeError ? 'ap-notice-error' : ''}`}>{notice}</span>}
        </div>

        <p className="ap-safety">
          <i className="fa-solid fa-shield-halved"></i>{' '}
          {t('autopilot.adSafetyNote', 'Autopilot only creates free organic posts. Paid ad campaigns always need your explicit approval — Markiv never spends your money on its own.')}
        </p>
      </div>

      {/* Posts waiting for the owner live on the Calendar, with every other post. */}
      {pendingApprovals.length > 0 && (
        <div className="ap-queue-pointer">
          <span>
            {t('autopilot.queue.pointer', {
              defaultValue: '{{count}} posts are waiting for your OK on the Calendar.',
              count: pendingApprovals.length,
            })}
          </span>
          {onGoToCalendar && (
            <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={onGoToCalendar} id="btn_ap_go_calendar">
              {t('autopilot.queue.open', 'Open Calendar')}
            </button>
          )}
        </div>
      )}

      <div className="ap-grid">
        {/* COMING UP */}
        {saved.enabled && !plan?.demo && plan?.upcoming?.length > 0 && (
          <section className="glass-card ap-card" aria-labelledby="ap_up_title">
            <h3 id="ap_up_title">{t('autopilot.plan.title', 'Coming up')}</h3>
            <ol className="ap-upcoming">
              {plan.upcoming.map((u) => (
                <li key={u.at}>
                  <time dateTime={u.at}>{when(u.at)}</time>
                  {u.theme && <span className="ui-badge is-accent">{themeLabel(u.theme)}</span>}
                </li>
              ))}
            </ol>
            <p className="ap-card-hint">{schedHint}</p>
          </section>
        )}

        {/* WHAT AUTOPILOT LEARNED */}
        <section className="glass-card ap-card" aria-labelledby="ap_learn_title">
          <div className="ap-card-head">
            <h3 id="ap_learn_title">{t('autopilot.learned.title', 'What Autopilot learned from your channel')}</h3>
            <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={relearn} disabled={relearning || !form.enabled} id="btn_ap_relearn">
              {relearning ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-rotate"></i>}{' '}
              {t('autopilot.learned.relearn', 'Read again')}
            </button>
          </div>

          {!style ? (
            <p className="text-muted">{t('autopilot.learned.none', 'Autopilot hasn’t read your channel yet. It does when you turn it on.')}</p>
          ) : (
            <>
              <p className="ap-learn-count">
                {style.sampleCount
                  ? t('autopilot.learned.count', { count: style.sampleCount, defaultValue: 'Learned from {{count}} of your posts.' })
                  : t('autopilot.learned.zero', 'Autopilot found no posts of yours to learn from yet.')}
              </p>
              {!style.sufficient && (
                <div className="ui-alert is-info ap-learn-alert">
                  {t('autopilot.learned.thin', { min: style.minPosts, defaultValue: 'That’s not enough to copy your style — Autopilot needs at least {{min}}. Until then it follows your answers.' })}
                </div>
              )}
              {style.voice && <p className="ap-learn-voice"><strong>{t('autopilot.learned.voice', 'How you write:')}</strong> {style.voice}</p>}
              {style.formatting && <p className="ap-learn-voice"><strong>{t('autopilot.learned.layout', 'How posts look:')}</strong> {style.formatting}</p>}
              {style.stats?.count > 0 && (
                <div className="ap-learn-badges">
                  <span className="ui-badge">{t(`autopilot.learned.length.${style.stats.lengthLevel}`, style.stats.lengthLevel)}</span>
                  <span className="ui-badge">{t(`autopilot.learned.emoji.${style.stats.emojiLevel}`, style.stats.emojiLevel)}</span>
                  <span className="ui-badge">{t('autopilot.learned.hashtags', { pct: style.stats.hashtagShare, defaultValue: 'Hashtags in {{pct}}% of posts' })}</span>
                  {style.stats.postsPerWeek != null && (
                    <span className="ui-badge">{t('autopilot.learned.perWeek', { n: style.stats.postsPerWeek, defaultValue: '~{{n}} posts a week' })}</span>
                  )}
                  {style.timing?.source === 'history' && (
                    <span className="ui-badge is-ok">{t('autopilot.learned.bestTime', { times: style.timing.times.join(', '), defaultValue: 'Best time: {{times}}' })}</span>
                  )}
                </div>
              )}
              {style.themes?.length > 0 && (
                <>
                  <h4 className="ap-learn-sub">{t('autopilot.learned.themes', 'What you post about')}</h4>
                  <ul className="ap-themes">
                    {style.themes.map((th) => (
                      <li key={th.key}>
                        <div className="ap-theme-top">
                          <span className="ap-theme-name">{th.name}</span>
                          <span className="ap-theme-share">{th.share}%</span>
                          {th.performance != null && th.performance >= 1.2 && <span className="ui-badge is-ok">{t('autopilot.learned.moreViews', 'more views')}</span>}
                          {th.performance != null && th.performance <= 0.8 && <span className="ui-badge">{t('autopilot.learned.fewerViews', 'fewer views')}</span>}
                        </div>
                        <div className="ap-theme-bar"><span style={{ width: `${Math.max(4, th.share)}%` }}></span></div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {style.habits?.length > 0 && (
                <>
                  <h4 className="ap-learn-sub">{t('autopilot.learned.habits', 'Habits Autopilot keeps')}</h4>
                  <ul className="ap-learn-list">{style.habits.map((h, i) => <li key={i}>{h}</li>)}</ul>
                </>
              )}
            </>
          )}
          <p className="ap-card-hint">
            {bot
              ? t('autopilot.learned.forwardTip', { bot: bot.username, defaultValue: 'Tip: forward a few of your best posts to @{{bot}} in Telegram. Autopilot learns from them too — even from a private channel.' })
              : t('autopilot.learned.connectTip', 'Tip: connect your Telegram channel through the Markivo bot (Settings → Telegram). Autopilot then reads every new post you make.')}
          </p>
        </section>
      </div>

      {/* THE BRIEF — every answer, editable any time; news first. */}
      <section className="glass-card ap-card ap-brief" aria-labelledby="ap_brief_title">
        <div className="ap-card-head">
          <h3 id="ap_brief_title">{t('autopilot.brief.title', 'Your brief for Autopilot')}</h3>
          <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={() => setBriefOpen((o) => !o)} aria-expanded={briefOpen} id="btn_ap_brief_toggle">
            {briefOpen ? t('autopilot.brief.close', 'Close') : t('autopilot.brief.edit', 'Edit answers')}
          </button>
        </div>

        <div className="ap-news">
          <label className="ui-label" htmlFor="inp_ap_news">{t('autopilot.brief.newsLabel', 'Anything new? Autopilot puts it in the next post.')}</label>
          <div className="ap-news-row">
            <input
              id="inp_ap_news"
              className="ui-input"
              value={newsDraft}
              maxLength={500}
              onChange={(e) => setNewsDraft(e.target.value)}
              placeholder={t('autopilot.q.news.ph', 'e.g. From Monday: pistachio latte, and 10% off before 11:00')}
            />
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              disabled={briefSaving || !newsDraft.trim()}
              onClick={async () => { if (await saveBrief({ news: newsDraft.trim() })) setNewsDraft(''); }}
              id="btn_ap_news"
            >
              {t('autopilot.brief.tell', 'Tell Autopilot')}
            </button>
          </div>
          {status?.brief?.news && (
            <p className="ap-card-hint">
              {t('autopilot.brief.currentNews', { news: status.brief.news, defaultValue: 'Current news: “{{news}}”' })}
              {' '}
              <button type="button" className="ap-link" onClick={() => saveBrief({ news: '' })}>{t('autopilot.brief.clearNews', 'Clear')}</button>
            </p>
          )}
        </div>

        {!briefOpen && (
          <ul className="ap-brief-summary">
            {(status?.questions || []).filter((q) => q.id !== 'schedule' && q.id !== 'news').map((q) => {
              const v = status?.brief?.[q.id];
              let shown;
              if (v === undefined || v === null || v === '') shown = <span className="text-muted">{t('autopilot.brief.notSet', 'not set')}</span>;
              else if (v === AUTO) shown = t('autopilot.q.auto', 'Let Autopilot decide');
              else if (Array.isArray(v)) shown = v.map((x) => t(`autopilot.q.${q.id}.opt.${x}`, (q.options || []).find((o) => o.value === x)?.label || x)).join(', ');
              else if (q.options) shown = t(`autopilot.q.${q.id}.opt.${v}`, (q.options.find((o) => o.value === v) || {}).label || v);
              else shown = v;
              return (
                <li key={q.id}>
                  <span className="ap-brief-q">{t(`autopilot.q.${q.id}.short`, q.label)}</span>
                  <span className="ap-brief-a">{shown}</span>
                </li>
              );
            })}
          </ul>
        )}

        {briefOpen && (
          <>
            <BriefForm
              questions={(status?.questions || []).filter((q) => q.id !== 'schedule' && q.id !== 'news')}
              values={briefForm}
              onChange={(id, val) => setBriefForm((b) => ({ ...b, [id]: val }))}
              disabled={briefSaving}
              idPrefix="apb"
            />
            <div className="ap-context-actions">
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                disabled={briefSaving}
                id="btn_ap_brief_save"
                onClick={async () => {
                  const patch = {};
                  for (const k of ['themes', 'themesOther', 'goal', 'tone', 'length', 'emoji', 'cta', 'avoid']) {
                    if (briefForm[k] !== undefined) patch[k] = briefForm[k];
                    else if (['cta', 'avoid'].includes(k)) patch[k] = '';
                  }
                  if (await saveBrief(patch)) setBriefOpen(false);
                }}
              >
                {briefSaving ? t('autopilot.saving', 'Saving…') : t('autopilot.brief.save', 'Save answers')}
              </button>
            </div>
          </>
        )}
      </section>

      {/* ACTIVITY LOG */}
      <div className="ap-activity">
        <h3>{t('autopilot.activityTitle', 'Activity')}</h3>
        {activity.length === 0 ? (
          <p className="text-muted">{t('autopilot.noActivity', 'Nothing yet. Turn Autopilot on and what it does shows up here.')}</p>
        ) : (
          <ul className="ap-activity-list">
            {activity.map((a) => {
              const m = KIND_META[a.kind] || { icon: 'fa-circle-info', key: a.kind, fallback: a.kind };
              const theme = a.payload?.theme ? { key: a.payload.theme, name: a.payload.themeName } : null;
              const at = a.payload?.slotAt || a.payload?.scheduledTime || a.payload?.scheduledFor;
              return (
                <li key={a.id} className={`ap-activity-item glass-card kind-${a.kind}`}>
                  <i className={`fa-solid ${m.icon} ap-activity-icon`}></i>
                  <div className="ap-activity-body">
                    <span className="ap-activity-kind">
                      {t(`autopilot.kind.${m.key}`, m.fallback)}
                      {theme && <span className="ui-badge is-accent ap-activity-theme">{themeLabel(theme)}</span>}
                      {at && a.kind !== 'analysis' && <span className="ap-activity-at">{t('autopilot.activity.for', { when: when(at), defaultValue: 'for {{when}}' })}</span>}
                    </span>
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
                  <time className="ap-activity-time">{new Date(a.created_at).toLocaleString(lang)}</time>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
