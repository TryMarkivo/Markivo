import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import { metaFor } from '../lib/platforms';
import { limitFor } from '../lib/platformLimits';
import MediaLibraryPicker from './MediaLibraryPicker';
import TemplatesModal from './TemplatesModal';
import './CreatePost.css';

// Local YYYY-MM-DDTHH:mm for a <input type="datetime-local">, in the
// viewer's own timezone — never toISOString(), which shifts to UTC.
const toLocalInputValue = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const EMOJI_PALETTE = [
  '😀', '😂', '😍', '🥰', '😎', '🤩', '🙌', '👏', '🔥', '✨',
  '🎉', '☕', '🍰', '🍕', '📸', '💯', '✅', '❤️', '👍', '🙏',
  '⭐', '🎁', '📍', '⏰', '🚀', '💡', '🌟', '🥳', '👀', '💬',
];

const TAG_SUGGESTIONS = ['Promo', 'Announcement', 'Behind the scenes', 'New product', 'Event', 'Sale'];

const newExtraPost = () => ({ id: `extra_${Date.now()}_${Math.random().toString(36).slice(2)}`, text: '', media: null });

/**
 * Multi-channel post composer, and — when `editEvent` is supplied — the same
 * screen doubles as the Edit Post view for an existing calendar row (one
 * fixed channel, no thread, Update/Delete instead of Post now/Add to Calendar).
 *
 * One shared ("global") caption + media by default; any selected channel can
 * be switched to its own independent override. "Add post" stacks further
 * messages that go out immediately after the one before, on every selected
 * channel. Every (channel × thread item) becomes its own /api/content/schedule
 * or /api/content/post-now call — mirrors PublishModal's per-platform-call
 * pattern, just with a richer single-screen layout and per-platform overrides.
 */
export default function CreatePost({ onClose, onScheduled, onGoToConnections, initialWhen, initialText, initialPlatform, initialMedia, editEvent }) {
  const { t } = useTranslation();
  const textareaRef = useRef(null);
  const emojiWrapRef = useRef(null);
  const [initialPlatformApplied, setInitialPlatformApplied] = useState(!initialPlatform);

  const [tgStatus, setTgStatus] = useState(null);
  const [igStatus, setIgStatus] = useState(null);
  const [catalogue, setCatalogue] = useState(null);

  const [selected, setSelected] = useState(editEvent ? [editEvent.platform] : []);
  const [globalText, setGlobalText] = useState(editEvent?.text || initialText || '');
  const [globalMedia, setGlobalMedia] = useState(initialMedia || null); // {id,url,kind} | null
  const [overrides, setOverrides] = useState({}); // { [key]: { text?, media? } }
  const [activeEditor, setActiveEditor] = useState('global'); // 'global' | channel key
  const [extraPosts, setExtraPosts] = useState([]); // [{id, text, media}] — "Add post" thread, create mode only
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mediaTarget, setMediaTarget] = useState(null); // null = active editor | an extraPost id
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [tag, setTag] = useState(editEvent?.tag || '');
  const [repeatRule, setRepeatRule] = useState(editEvent?.repeatRule || ''); // '' | 'daily' | 'weekly' | 'monthly'

  const [when, setWhen] = useState(() => toLocalInputValue(
    editEvent ? new Date(editEvent.scheduledTime) : initialWhen ? new Date(initialWhen) : new Date(Date.now() + 86400000)
  ));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null); // [{key, label, ok, message}]
  const [resultsKind, setResultsKind] = useState('scheduled'); // 'draft' | 'scheduled' | 'posted'

  useEffect(() => {
    api.get('/api/telegram/status').then(setTgStatus).catch(() => setTgStatus({ connected: false }));
    api.get('/api/instagram/status').then(setIgStatus).catch(() => setIgStatus({ connected: false }));
    api.get('/api/connect/status').then(setCatalogue).catch(() => setCatalogue({ catalogue: [], status: {} }));
  }, []);

  // Resolve the existing post's attached media (the calendar feed only carries
  // its id) so the editor opens with it already showing, exactly like a fresh
  // upload would.
  useEffect(() => {
    if (!editEvent?.mediaId) return;
    let cancelled = false;
    api.get('/api/media')
      .then((data) => {
        if (cancelled) return;
        const item = (data.items || []).find((i) => i.id === editEvent.mediaId);
        if (item) setGlobalMedia({ id: item.id, url: item.filePath, kind: item.kind });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [editEvent?.mediaId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (emojiOpen) setEmojiOpen(false);
      else if (!busy) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy, emojiOpen]);

  useEffect(() => {
    if (!emojiOpen) return;
    const onDocClick = (e) => { if (!emojiWrapRef.current?.contains(e.target)) setEmojiOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [emojiOpen]);

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

  // A draft handed off from AI Generation or Edit Templates arrives with the
  // channel it was written for already known — pre-select it once, the
  // moment the channel list is ready, rather than making the owner pick it
  // again. Adjusted directly during render (React's documented pattern for
  // deriving state from a prop) rather than in an effect, so there is no
  // extra render pass or effect-in-effect setState warning.
  if (!editEvent && !initialPlatformApplied && !loading && channels.some((c) => c.key === initialPlatform)) {
    setInitialPlatformApplied(true);
    setSelected([initialPlatform]);
  }

  // The one channel a post being edited belongs to might not currently show up
  // in `channels` (nothing re-verifies the connection here) — fall back to
  // metaFor so the header still renders something sensible.
  const editChannel = useMemo(() => {
    if (!editEvent) return null;
    const found = channels.find((c) => c.key === editEvent.platform);
    if (found) return found;
    const m = metaFor(editEvent.platform === 'instagram' ? 'meta_instagram' : editEvent.platform);
    return { key: editEvent.platform, label: editEvent.platform, icon: m.icon, color: m.color, handle: null };
  }, [editEvent, channels]);

  const toggleChannel = (key) => {
    if (editEvent) return; // fixed to one channel
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
    if (!window.confirm(t('createPost.resetConfirm', 'This channel has content of its own — reset it back to the global text and media? This cannot be undone.'))) return;
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (activeEditor === key) setActiveEditor('global');
  };

  const insertEmoji = (emoji) => {
    const el = textareaRef.current;
    if (!el) {
      setActiveText(activeValue + emoji);
      setEmojiOpen(false);
      return;
    }
    const start = el.selectionStart ?? activeValue.length;
    const end = el.selectionEnd ?? activeValue.length;
    setActiveText(activeValue.slice(0, start) + emoji + activeValue.slice(end));
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const openPickerFor = (target) => { setMediaTarget(target); setPickerOpen(true); };
  const addExtraPost = () => setExtraPosts((p) => [...p, newExtraPost()]);
  const updateExtraText = (id, text) => setExtraPosts((p) => p.map((x) => (x.id === id ? { ...x, text } : x)));
  const setExtraMedia = (id, media) => setExtraPosts((p) => p.map((x) => (x.id === id ? { ...x, media } : x)));
  const removeExtraPost = (id) => setExtraPosts((p) => p.filter((x) => x.id !== id));

  const activeChannel = activeEditor === 'global' ? null : channels.find((c) => c.key === activeEditor);
  const activeValue = activeEditor === 'global' ? globalText : effectiveFor(activeEditor).text;
  const activeMedia = activeEditor === 'global' ? globalMedia : effectiveFor(activeEditor).media;
  // Editing globally, the binding constraint is the tightest limit among
  // channels still using the shared text — say so rather than a made-up cap.
  const nonOverriddenSelected = selected.filter((k) => !effectiveFor(k).overridden);
  const activeLimit = activeEditor === 'global'
    ? (nonOverriddenSelected.length ? Math.min(...nonOverriddenSelected.map(limitFor)) : null)
    : limitFor(activeEditor);
  // Thread items apply to every selected channel at once, so their limit is
  // the tightest among all of them — not just the ones still on shared text.
  const threadLimit = selected.length ? Math.min(...selected.map(limitFor)) : null;

  const nothingConnected = !editEvent && !loading && channels.length === 0;
  const now = new Date();
  now.setSeconds(0, 0);

  const nonEmptyExtras = () => extraPosts.filter((p) => p.text.trim().length);

  const submit = async (status) => {
    if (!selected.length || busy) return;
    const extras = nonEmptyExtras();
    const overLimit = selected.filter((k) => effectiveFor(k).text.length > limitFor(k) || extras.some((p) => p.text.length > limitFor(k)));
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
    const baseTime = new Date(when).getTime();
    const outcomes = [];
    for (const key of selected) {
      const ch = channels.find((c) => c.key === key);
      const eff = effectiveFor(key);
      const sequence = [{ text: eff.text.trim(), media: eff.media }, ...extras.map((p) => ({ text: p.text.trim(), media: p.media }))];
      try {
        for (let i = 0; i < sequence.length; i++) {
          // Each post in the thread lands a minute after the one before it, so
          // it publishes right after — never at the exact same instant.
          await api.post('/api/content/schedule', {
            platform: key,
            postText: sequence[i].text,
            mediaId: sequence[i].media?.id || null,
            scheduledTime: new Date(baseTime + i * 60000).toISOString(),
            status,
            tag: tag.trim() || undefined,
            repeatRule: i === 0 ? (repeatRule || undefined) : undefined,
          });
        }
        outcomes.push({ key, label: ch?.label || key, ok: true });
      } catch (err) {
        outcomes.push({ key, label: ch?.label || key, ok: false, message: err.message || t('common.somethingWentWrong', 'Something went wrong') });
      }
    }
    setResults(outcomes);
    setResultsKind(status === 'draft' ? 'draft' : 'scheduled');
    setBusy(false);
    if (outcomes.some((o) => o.ok)) onScheduled?.();
  };

  const postNow = async () => {
    if (!selected.length || busy) return;
    if (!selected.some((k) => effectiveFor(k).text.trim().length)) {
      setError(t('createPost.emptyText', 'Write something before posting.'));
      return;
    }

    setBusy(true);
    setError('');
    const extras = nonEmptyExtras();
    const outcomes = [];
    for (const key of selected) {
      const ch = channels.find((c) => c.key === key);
      const eff = effectiveFor(key);
      const sequence = [{ text: eff.text.trim(), media: eff.media }, ...extras.map((p) => ({ text: p.text.trim(), media: p.media }))];
      try {
        // Sequential awaits fire each post right after the previous one lands.
        for (const item of sequence) {
          await api.post('/api/content/post-now', { platform: key, postText: item.text, mediaId: item.media?.id || null });
        }
        outcomes.push({ key, label: ch?.label || key, ok: true });
      } catch (err) {
        outcomes.push({ key, label: ch?.label || key, ok: false, message: err.message || t('common.somethingWentWrong', 'Something went wrong') });
      }
    }
    setResults(outcomes);
    setResultsKind('posted');
    setBusy(false);
    if (outcomes.some((o) => o.ok)) onScheduled?.();
  };

  const handleUpdate = async (status) => {
    if (busy || !editEvent) return;
    const text = globalText.trim();
    const limit = limitFor(editEvent.platform);
    if (text.length > limit) {
      setError(t('createPost.overLimit', { defaultValue: 'Over the character limit for: {{names}}', names: editChannel?.label || editEvent.platform }));
      return;
    }
    if (!text) {
      setError(t('createPost.emptyText', 'Write something before scheduling.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/calendar/events/${editEvent.id}`, {
        postText: text,
        mediaId: globalMedia?.id || null,
        tag: tag.trim() || null,
        repeatRule: repeatRule || null,
        status,
        start: { dateTime: new Date(when).toISOString() },
      });
      onScheduled?.();
      onClose?.();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy || !editEvent) return;
    if (!window.confirm(t('createPost.deleteConfirm', 'Delete this post? This cannot be undone.'))) return;
    setBusy(true);
    setError('');
    try {
      await api.del(`/api/calendar/events/${editEvent.id}`);
      onScheduled?.();
      onClose?.();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
      setBusy(false);
    }
  };

  return (
    <div className="auth-overlay animate-fade-in" id="create_post_modal" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <div className="cp-card glass-card glass-card-glow text-left" role="dialog" aria-modal="true" aria-labelledby="cp_title">
        <div className="auth-header flex-between mb-20">
          <h3 id="cp_title">
            <i className={`fa-solid ${editEvent ? 'fa-pen' : 'fa-pen-to-square'}`}></i>{' '}
            {editEvent ? t('createPost.editTitle', 'Edit Post') : t('createPost.title', 'Create Post')}
          </h3>
          <button className="btn-close" onClick={onClose} disabled={busy} id="btn_close_create_post" aria-label={t('common.close', 'Close')}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {loading && !editEvent ? (
          <div className="text-center" style={{ padding: 40 }}><i className="fa-solid fa-spinner fa-spin fa-2x text-accent"></i></div>
        ) : results ? (
          <div className="step-content">
            <ul className="publish-results">
              {results.map((r) => (
                <li key={r.key} className={r.ok ? 'ok' : 'failed'}>
                  <i className={`fa-solid ${r.ok ? 'fa-circle-check' : 'fa-circle-exclamation'}`}></i>
                  <div>
                    <strong>{r.label}</strong>
                    <span>{r.ok ? t(`createPost.result.${resultsKind}`, 'Added to calendar') : r.message}</span>
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

              {editEvent ? (
                <div className="cp-edit-channel-badge">
                  <span className="cp-mock-avatar" style={{ '--ch-color': editChannel?.color }}><i className={editChannel?.icon}></i></span>
                  <div>
                    <strong>{editChannel?.label}</strong>
                    {editChannel?.handle && <span className="cp-mock-handle"> · {editChannel.handle}</span>}
                  </div>
                </div>
              ) : (
                <>
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
                </>
              )}

              <textarea
                ref={textareaRef}
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
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openPickerFor(null)} disabled={busy} id="btn_cp_insert_media">
                  <i className="fa-solid fa-image"></i> {t('createPost.insertMedia', 'Insert Media')}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTemplatesOpen(true)} disabled={busy} id="btn_cp_templates">
                  <i className="fa-solid fa-shapes"></i> {t('createPost.templates', 'Templates')}
                </button>
                <div className="cp-emoji-wrap" ref={emojiWrapRef}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setEmojiOpen((o) => !o)}
                    disabled={busy}
                    id="btn_cp_emoji"
                    aria-label={t('createPost.emoji', 'Emoji')}
                  >
                    <i className="fa-regular fa-face-smile"></i>
                  </button>
                  {emojiOpen && (
                    <div className="cp-emoji-pop">
                      {EMOJI_PALETTE.map((em) => (
                        <button type="button" key={em} onClick={() => insertEmoji(em)} className="cp-emoji-btn">{em}</button>
                      ))}
                    </div>
                  )}
                </div>
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

              {/* "Add post" thread — further messages that go out right after the
                  one above, on every selected channel. Not offered while editing
                  an existing single post. */}
              {!editEvent && (
                <div className="cp-thread">
                  {extraPosts.map((p, idx) => (
                    <div key={p.id} className="cp-thread-item">
                      <span className="cp-thread-connector" aria-hidden="true"></span>
                      <textarea
                        className="input-field cp-textarea cp-thread-textarea"
                        rows={3}
                        placeholder={t('createPost.addPostPlaceholder', { defaultValue: 'Post #{{n}} — goes out right after the one above…', n: idx + 2 })}
                        value={p.text}
                        onChange={(e) => updateExtraText(p.id, e.target.value)}
                        disabled={busy}
                        id={`inp_cp_thread_${idx}`}
                      />
                      <div className="cp-toolbar">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openPickerFor(p.id)} disabled={busy}>
                          <i className="fa-solid fa-image"></i> {t('createPost.insertMedia', 'Insert Media')}
                        </button>
                        {p.media && (
                          <span className="cp-media-chip">
                            <i className={`fa-solid ${p.media.kind === 'video' ? 'fa-video' : 'fa-image'}`}></i>
                            {t(p.media.kind === 'video' ? 'media.attach.video' : 'media.attach.photo', p.media.kind === 'video' ? 'Video' : 'Photo')}
                            <button type="button" onClick={() => setExtraMedia(p.id, null)} disabled={busy} aria-label={t('media.attach.remove', 'Remove')}>
                              <i className="fa-solid fa-xmark"></i>
                            </button>
                          </span>
                        )}
                        <button
                          type="button"
                          className="cp-thread-remove"
                          onClick={() => removeExtraPost(p.id)}
                          disabled={busy}
                          aria-label={t('createPost.removePost', 'Remove this post')}
                          title={t('createPost.removePost', 'Remove this post')}
                        >
                          <i className="fa-solid fa-trash"></i>
                        </button>
                        <span className={`cp-counter ${threadLimit !== null && p.text.length > threadLimit ? 'over' : ''}`}>
                          {p.text.length}{threadLimit !== null ? ` / ${threadLimit}` : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                  <button type="button" className="btn btn-secondary cp-add-post-btn" onClick={addExtraPost} disabled={busy} id="btn_cp_add_post">
                    <i className="fa-solid fa-plus"></i> {t('createPost.addPost', 'Add post')}
                  </button>
                </div>
              )}

              <div className="cp-meta-row">
                <input
                  type="text"
                  className="input-field cp-tag-input"
                  list="cp_tag_suggestions"
                  placeholder={t('createPost.tagPlaceholder', 'Add a tag…')}
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  disabled={busy}
                  id="inp_cp_tag"
                  aria-label={t('createPost.tag', 'Tag')}
                />
                <datalist id="cp_tag_suggestions">
                  {TAG_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
                </datalist>
                <select
                  className="input-field cp-repeat-select"
                  value={repeatRule}
                  onChange={(e) => setRepeatRule(e.target.value)}
                  disabled={busy}
                  id="sel_cp_repeat"
                  aria-label={t('createPost.repeat', 'Repeat')}
                >
                  <option value="">{t('createPost.repeatNone', "Doesn't repeat")}</option>
                  <option value="daily">{t('createPost.repeatDaily', 'Repeat daily')}</option>
                  <option value="weekly">{t('createPost.repeatWeekly', 'Repeat weekly')}</option>
                  <option value="monthly">{t('createPost.repeatMonthly', 'Repeat monthly')}</option>
                </select>
              </div>

              <div className="cp-bottom-bar">
                {editEvent && (
                  <button type="button" className="cp-delete-post" onClick={handleDelete} disabled={busy} id="btn_cp_delete_post">
                    <i className="fa-solid fa-trash"></i> {t('createPost.deletePost', 'Delete Post')}
                  </button>
                )}
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
                  <button
                    className="btn btn-secondary"
                    onClick={() => (editEvent ? handleUpdate('draft') : submit('draft'))}
                    disabled={!selected.length || busy}
                    id="btn_cp_save_draft"
                  >
                    {busy ? t('createPost.saving', 'Saving…') : t('createPost.saveDraft', 'Save as draft')}
                  </button>
                  {!editEvent && (
                    <button className="btn btn-secondary" onClick={postNow} disabled={!selected.length || busy} id="btn_cp_post_now">
                      {busy
                        ? <><i className="fa-solid fa-spinner fa-spin"></i> {t('createPost.posting', 'Posting…')}</>
                        : <><i className="fa-solid fa-paper-plane"></i> {t('createPost.postNow', 'Post now')}</>}
                    </button>
                  )}
                  <button
                    className="btn btn-primary"
                    onClick={() => (editEvent ? handleUpdate('scheduled') : submit('scheduled'))}
                    disabled={!selected.length || busy}
                    id="btn_cp_add_calendar"
                  >
                    {editEvent
                      ? (busy ? <><i className="fa-solid fa-spinner fa-spin"></i> {t('createPost.updating', 'Updating…')}</> : <><i className="fa-solid fa-check"></i> {t('createPost.update', 'Update')}</>)
                      : (busy ? <><i className="fa-solid fa-spinner fa-spin"></i> {t('createPost.scheduling', 'Scheduling…')}</> : <><i className="fa-solid fa-calendar-plus"></i> {t('createPost.addToCalendar', 'Add to Calendar')}</>)}
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
                    const ch = editEvent ? editChannel : channels.find((c) => c.key === key);
                    const eff = effectiveFor(key);
                    const over = eff.text.length > limitFor(key);
                    const kind = key === 'instagram' ? 'instagram' : key === 'telegram' ? 'telegram' : 'generic';
                    const media = eff.media && (
                      eff.media.kind === 'video'
                        ? <video src={api.mediaUrl(eff.media.url)} className="cp-preview-media" muted controls />
                        : <img src={api.mediaUrl(eff.media.url)} className="cp-preview-media" alt="" />
                    );
                    const caption = eff.text.trim()
                      ? eff.text
                      : <span className="text-muted">{t('createPost.previewNothing', 'Nothing written yet…')}</span>;
                    return (
                      <div key={key} className={`cp-preview-card cp-mock-${kind}`}>
                        {!editEvent && (
                          <span className="cp-preview-edit-badge">
                            {eff.overridden ? t('createPost.platformEdit', { defaultValue: '{{label}} Edit', label: ch.label }) : t('createPost.globalEdit', 'Global Edit')}
                          </span>
                        )}

                        <div className="cp-mock-head">
                          <span className="cp-mock-avatar" style={{ '--ch-color': ch.color }}><i className={ch.icon}></i></span>
                          <div className="cp-mock-identity">
                            <strong>{ch.label}</strong>
                            {kind === 'telegram' && <i className="fa-solid fa-circle-check cp-mock-verified"></i>}
                            {ch.handle && <span className="cp-mock-handle">{ch.handle}</span>}
                          </div>
                        </div>

                        {kind === 'telegram' ? (
                          <div className="cp-mock-bubble">
                            {media}
                            <p className="cp-preview-text">{caption}</p>
                          </div>
                        ) : (
                          <>
                            {media}
                            {kind === 'instagram' && (
                              <div className="cp-mock-ig-actions">
                                <i className="fa-regular fa-heart"></i>
                                <i className="fa-regular fa-comment"></i>
                                <i className="fa-regular fa-paper-plane"></i>
                                <i className="fa-regular fa-bookmark cp-mock-ig-save"></i>
                              </div>
                            )}
                            <p className="cp-preview-text">
                              {kind === 'instagram' && ch.label && <strong>{ch.label} </strong>}
                              {caption}
                            </p>
                          </>
                        )}

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
          onSelect={(media) => { if (mediaTarget) setExtraMedia(mediaTarget, media); else setActiveMedia(media); setMediaTarget(null); }}
          onClose={() => { setPickerOpen(false); setMediaTarget(null); }}
        />
      )}

      {templatesOpen && (
        <TemplatesModal
          onClose={() => setTemplatesOpen(false)}
          onUseTemplate={(text, media) => {
            setActiveText(text);
            setActiveMedia(media);
            setTemplatesOpen(false);
          }}
        />
      )}
    </div>
  );
}
