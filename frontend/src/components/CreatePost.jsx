import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import { metaFor } from '../lib/platforms';
import { limitFor } from '../lib/platformLimits';
import MediaLibraryPicker from './MediaLibraryPicker';
import './CreatePost.css';

// Local YYYY-MM-DDTHH:mm for a <input type="datetime-local">, in the
// viewer's own timezone — never toISOString(), which shifts to UTC.
const toLocalInputValue = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Multi-channel post composer. One shared ("global") caption + media by
 * default; any selected channel can be switched to its own independent
 * override. Every selected channel becomes its own /api/content/schedule
 * call on submit — mirrors PublishModal's per-platform-call pattern, just
 * with a richer single-screen layout and per-platform overrides.
 */
export default function CreatePost({ onClose, onScheduled, onGoToConnections }) {
  const { t } = useTranslation();

  const [tgStatus, setTgStatus] = useState(null);
  const [igStatus, setIgStatus] = useState(null);
  const [catalogue, setCatalogue] = useState(null);

  const [selected, setSelected] = useState([]);
  const [globalText, setGlobalText] = useState('');
  const [globalMedia, setGlobalMedia] = useState(null); // {id,url,kind} | null
  const [overrides, setOverrides] = useState({}); // { [key]: { text?, media? } }
  const [activeEditor, setActiveEditor] = useState('global'); // 'global' | channel key
  const [pickerOpen, setPickerOpen] = useState(false);

  const [when, setWhen] = useState(() => toLocalInputValue(new Date(Date.now() + 86400000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null); // [{key, label, ok, message}]

  useEffect(() => {
    api.get('/api/telegram/status').then(setTgStatus).catch(() => setTgStatus({ connected: false }));
    api.get('/api/instagram/status').then(setIgStatus).catch(() => setIgStatus({ connected: false }));
    api.get('/api/connect/status').then(setCatalogue).catch(() => setCatalogue({ catalogue: [], status: {} }));
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const loading = tgStatus === null || igStatus === null || catalogue === null;

  // Instagram and Telegram come from their bespoke, actually-used-for-publishing
  // connections; every other platform comes from the generic connector
  // catalogue. meta_instagram is skipped — it's a SEPARATE, unrelated
  // connection record from the bespoke Instagram Login flow this dashboard
  // otherwise uses everywhere, and showing both would just be confusing.
  const channels = useMemo(() => {
    if (loading) return [];
    const list = [];
    if (igStatus?.connected) {
      const m = metaFor('meta_instagram');
      list.push({ key: 'instagram', label: 'Instagram', icon: m.icon, color: m.color, handle: igStatus.username ? `@${igStatus.username}` : igStatus.accountName });
    }
    if (tgStatus?.connected && tgStatus?.chat) {
      const m = metaFor('telegram');
      list.push({ key: 'telegram', label: 'Telegram', icon: m.icon, color: m.color, handle: tgStatus.chat.chatTitle });
    }
    for (const p of catalogue.catalogue || []) {
      if (p.key === 'telegram' || p.key === 'meta_instagram') continue;
      const s = catalogue.status[p.key];
      if (s?.connected) {
        const m = metaFor(p.key);
        list.push({ key: p.key, label: p.label, icon: m.icon, color: m.color, handle: s.accountHandle });
      }
    }
    return list;
  }, [loading, igStatus, tgStatus, catalogue]);

  const toggleChannel = (key) => {
    setSelected((cur) => {
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      if (activeEditor === key && !next.includes(key)) setActiveEditor('global');
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelected((cur) => (cur.length === channels.length ? [] : channels.map((c) => c.key)));
  };

  const effectiveFor = (key) => {
    const ov = overrides[key];
    return {
      text: ov && 'text' in ov ? ov.text : globalText,
      media: ov && 'media' in ov ? ov.media : globalMedia,
      overridden: !!ov && ('text' in ov || 'media' in ov),
    };
  };

  const setActiveText = (value) => {
    if (activeEditor === 'global') setGlobalText(value);
    else setOverrides((prev) => ({ ...prev, [activeEditor]: { ...prev[activeEditor], text: value } }));
  };
  const setActiveMedia = (media) => {
    if (activeEditor === 'global') setGlobalMedia(media);
    else setOverrides((prev) => ({ ...prev, [activeEditor]: { ...prev[activeEditor], media } }));
  };
  const resetOverride = (key) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (activeEditor === key) setActiveEditor('global');
  };

  const activeChannel = activeEditor === 'global' ? null : channels.find((c) => c.key === activeEditor);
  const activeValue = activeEditor === 'global' ? globalText : effectiveFor(activeEditor).text;
  const activeMedia = activeEditor === 'global' ? globalMedia : effectiveFor(activeEditor).media;
  // Editing globally, the binding constraint is the tightest limit among
  // channels still using the shared text — say so rather than a made-up cap.
  const nonOverriddenSelected = selected.filter((k) => !effectiveFor(k).overridden);
  const activeLimit = activeEditor === 'global'
    ? (nonOverriddenSelected.length ? Math.min(...nonOverriddenSelected.map(limitFor)) : null)
    : limitFor(activeEditor);

  const nothingConnected = !loading && channels.length === 0;
  const now = new Date();
  now.setSeconds(0, 0);

  const submit = async (status) => {
    if (!selected.length || busy) return;
    const overLimit = selected.filter((k) => effectiveFor(k).text.length > limitFor(k));
    if (overLimit.length) {
      const names = overLimit.map((k) => channels.find((c) => c.key === k)?.label || k).join(', ');
      setError(t('createPost.overLimit', { defaultValue: 'Over the character limit for: {{names}}', names }));
      return;
    }
    if (!selected.some((k) => effectiveFor(k).text.trim().length)) {
      setError(t('createPost.emptyText', 'Write something before scheduling.'));
      return;
    }

    setBusy(true);
    setError('');
    const scheduledTime = new Date(when).toISOString();
    const outcomes = [];
    for (const key of selected) {
      const ch = channels.find((c) => c.key === key);
      const eff = effectiveFor(key);
      try {
        await api.post('/api/content/schedule', {
          platform: key,
          postText: eff.text.trim(),
          mediaId: eff.media?.id || null,
          scheduledTime,
          status,
        });
        outcomes.push({ key, label: ch?.label || key, ok: true });
      } catch (err) {
        outcomes.push({ key, label: ch?.label || key, ok: false, message: err.message || t('common.somethingWentWrong', 'Something went wrong') });
      }
    }
    setResults(outcomes);
    setBusy(false);
    if (outcomes.some((o) => o.ok)) onScheduled?.();
  };

  return (
    <div className="auth-overlay animate-fade-in" id="create_post_modal" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <div className="cp-card glass-card glass-card-glow text-left" role="dialog" aria-modal="true" aria-labelledby="cp_title">
        <div className="auth-header flex-between mb-20">
          <h3 id="cp_title"><i className="fa-solid fa-pen-to-square"></i> {t('createPost.title', 'Create Post')}</h3>
          <button className="btn-close" onClick={onClose} disabled={busy} id="btn_close_create_post" aria-label={t('common.close', 'Close')}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {loading ? (
          <div className="text-center" style={{ padding: 40 }}><i className="fa-solid fa-spinner fa-spin fa-2x text-accent"></i></div>
        ) : results ? (
          <div className="step-content">
            <ul className="publish-results">
              {results.map((r) => (
                <li key={r.key} className={r.ok ? 'ok' : 'failed'}>
                  <i className={`fa-solid ${r.ok ? 'fa-circle-check' : 'fa-circle-exclamation'}`}></i>
                  <div>
                    <strong>{r.label}</strong>
                    <span>{r.ok ? t('createPost.scheduled', 'Added to calendar') : r.message}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="publish-actions">
              <button className="btn btn-primary" onClick={onClose} id="btn_create_post_done">{t('common.done', 'Done')}</button>
            </div>
          </div>
        ) : nothingConnected ? (
          <div className="cp-empty">
            <i className="fa-solid fa-plug-circle-xmark fa-2x text-muted"></i>
            <p className="text-muted">{t('createPost.noneConnected', 'Connect a channel first — then it shows up here to post to.')}</p>
            {onGoToConnections && (
              <button className="btn btn-primary" onClick={onGoToConnections} id="btn_cp_go_connections">
                {t('createPost.goToConnections', 'Go to Connections')}
              </button>
            )}
          </div>
        ) : (
          <div className="cp-body">
            <div className="cp-editor-col">
              {error && <div className="auth-error-box mb-20" role="alert">{error}</div>}

              <div className="cp-channel-row">
                {channels.map((ch) => (
                  <button
                    key={ch.key}
                    type="button"
                    className={`cp-avatar ${selected.includes(ch.key) ? 'selected' : ''}`}
                    style={{ '--ch-color': ch.color }}
                    onClick={() => toggleChannel(ch.key)}
                    title={ch.handle ? `${ch.label} · ${ch.handle}` : ch.label}
                    id={`btn_cp_channel_${ch.key}`}
                  >
                    <i className={ch.icon}></i>
                  </button>
                ))}
                <button type="button" className="cp-select-all" onClick={toggleSelectAll} id="btn_cp_select_all">
                  {selected.length === channels.length ? t('createPost.deselectAll', 'Deselect all') : t('createPost.selectAll', 'Select all')}
                </button>
              </div>

              <div className="cp-pill-row">
                <button type="button" className={`cp-pill ${activeEditor === 'global' ? 'active' : ''}`} onClick={() => setActiveEditor('global')} id="btn_cp_pill_global">
                  <i className="fa-solid fa-earth-americas"></i> {t('createPost.globalEdit', 'Global Edit')}
                </button>
                {selected.map((key) => {
                  const ch = channels.find((c) => c.key === key);
                  const overridden = effectiveFor(key).overridden;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`cp-pill ${activeEditor === key ? 'active' : ''} ${overridden ? 'overridden' : ''}`}
                      onClick={() => setActiveEditor(key)}
                      id={`btn_cp_pill_${key}`}
                    >
                      <i className={ch.icon} style={{ color: ch.color }}></i> {ch.label}{overridden ? ' •' : ''}
                    </button>
                  );
                })}
              </div>

              <textarea
                className="input-field cp-textarea"
                rows={6}
                placeholder={activeEditor === 'global'
                  ? t('createPost.globalPlaceholder', 'This will be posted to all the channels together…')
                  : t('createPost.overridePlaceholder', { defaultValue: 'Write content just for {{label}}…', label: activeChannel?.label })}
                value={activeValue}
                onChange={(e) => setActiveText(e.target.value)}
                disabled={busy}
                id="inp_cp_textarea"
              />

              <div className="cp-toolbar">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPickerOpen(true)} disabled={busy} id="btn_cp_insert_media">
                  <i className="fa-solid fa-image"></i> {t('createPost.insertMedia', 'Insert Media')}
                </button>
                {activeMedia && (
                  <span className="cp-media-chip">
                    <i className={`fa-solid ${activeMedia.kind === 'video' ? 'fa-video' : 'fa-image'}`}></i>
                    {t(activeMedia.kind === 'video' ? 'media.attach.video' : 'media.attach.photo', activeMedia.kind === 'video' ? 'Video' : 'Photo')}
                    <button type="button" onClick={() => setActiveMedia(null)} disabled={busy} aria-label={t('media.attach.remove', 'Remove')} id="btn_cp_remove_media">
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </span>
                )}
                {activeEditor !== 'global' && effectiveFor(activeEditor).overridden && (
                  <button type="button" className="btn btn-text btn-sm" onClick={() => resetOverride(activeEditor)} disabled={busy} id="btn_cp_reset_override">
                    {t('createPost.resetToGlobal', 'Reset to global')}
                  </button>
                )}
                <span className={`cp-counter ${activeLimit !== null && activeValue.length > activeLimit ? 'over' : ''}`}>
                  {activeValue.length}{activeLimit !== null ? ` / ${activeLimit}` : ''}
                </span>
              </div>

              <div className="cp-bottom-bar">
                <input
                  type="datetime-local"
                  className="input-field"
                  value={when}
                  min={toLocalInputValue(now)}
                  onChange={(e) => setWhen(e.target.value)}
                  disabled={busy}
                  id="inp_cp_when"
                />
                <div className="cp-bottom-actions">
                  <button className="btn btn-secondary" onClick={() => submit('draft')} disabled={!selected.length || busy} id="btn_cp_save_draft">
                    {busy ? t('createPost.saving', 'Saving…') : t('createPost.saveDraft', 'Save as draft')}
                  </button>
                  <button className="btn btn-primary" onClick={() => submit('scheduled')} disabled={!selected.length || busy} id="btn_cp_add_calendar">
                    {busy
                      ? <><i className="fa-solid fa-spinner fa-spin"></i> {t('createPost.scheduling', 'Scheduling…')}</>
                      : <><i className="fa-solid fa-calendar-plus"></i> {t('createPost.addToCalendar', 'Add to Calendar')}</>}
                  </button>
                </div>
              </div>
            </div>

            <div className="cp-preview-col">
              <h4>{t('createPost.previewTitle', 'Post Preview')}</h4>
              {selected.length === 0 ? (
                <p className="text-muted cp-preview-empty">{t('createPost.previewEmpty', 'Select a channel to preview your post.')}</p>
              ) : (
                <div className="cp-preview-list">
                  {selected.map((key) => {
                    const ch = channels.find((c) => c.key === key);
                    const eff = effectiveFor(key);
                    const over = eff.text.length > limitFor(key);
                    return (
                      <div key={key} className="cp-preview-card">
                        <div className="cp-preview-head">
                          <i className={ch.icon} style={{ color: ch.color }}></i>
                          <strong>{eff.overridden ? t('createPost.platformEdit', { defaultValue: '{{label}} Edit', label: ch.label }) : t('createPost.globalEdit', 'Global Edit')}</strong>
                        </div>
                        {eff.media && (
                          eff.media.kind === 'video'
                            ? <video src={api.mediaUrl(eff.media.url)} className="cp-preview-media" muted controls />
                            : <img src={api.mediaUrl(eff.media.url)} className="cp-preview-media" alt="" />
                        )}
                        <p className="cp-preview-text">
                          {eff.text.trim() ? eff.text : <span className="text-muted">{t('createPost.previewNothing', 'Nothing written yet…')}</span>}
                        </p>
                        <span className={`cp-counter ${over ? 'over' : ''}`}>{eff.text.length} / {limitFor(key)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {pickerOpen && (
        <MediaLibraryPicker
          onSelect={(media) => setActiveMedia(media)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
