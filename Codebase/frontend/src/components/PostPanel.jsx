import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import { limitFor } from '../lib/platformLimits';
import { channelInfo } from '../lib/channels';
import { isEditable, repeatOf, statusOf } from '../lib/calendarEvents';
import { dayLong, timeOf } from '../lib/dates';
import Icon, { ChannelMark } from './ui/Icon';
import MediaLibraryPicker from './MediaLibraryPicker';
import TemplatesModal from './TemplatesModal';
import './PostPanel.css';

// <input type="datetime-local"> wants local time — never toISOString(), which is UTC.
const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const isPast = (d) => d.getTime() < Date.now() - 60000;

const nextFullHour = () => new Date(Math.ceil((Date.now() + 30 * 60000) / 3600000) * 3600000);

// One-tap changes for the AI rewrite box. The value is the instruction sent
// to the writer; the label is shown in the interface language.
const QUICK_CHANGES = [
  ['shorter', 'Shorter', 'Make it shorter. Keep the main point.'],
  ['fix', 'Fix mistakes', 'Fix spelling and grammar mistakes. Change nothing else.'],
  ['uz', 'In Uzbek', 'Rewrite it in Uzbek (Latin script). Keep the meaning, emojis and hashtags.'],
  ['ru', 'In Russian', 'Rewrite it in Russian. Keep the meaning, emojis and hashtags.'],
  ['en', 'In English', 'Rewrite it in English. Keep the meaning, emojis and hashtags.'],
];

const CHANNEL_KEYS = ['instagram', 'telegram'];

/**
 * One panel for everything about a single post: write a new one, open an
 * existing one to edit, move or delete it, or look at one that already went
 * out. Replaces the old Create Post, Post details, AI Generation and AI Editor
 * popups.
 *
 * `event` is a calendar feed event (null for a new post). `initial` seeds a new
 * post from elsewhere in the app: { when, text, media, channel }.
 */
export default function PostPanel({ activeProfile, event, initial = {}, onClose, onSaved, onGoToConnections }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const priv = event?.extendedProperties?.private || {};
  const mode = !event ? 'create' : isEditable(event) ? 'edit' : 'view';
  const status = event ? statusOf(event) : null;

  const [statuses, setStatuses] = useState(null); // { instagram: {...}, telegram: {...} }
  const [channels, setChannels] = useState(() => {
    if (event) return [priv.platform || 'instagram'];
    return [initial.channel || 'instagram'];
  });
  const [text, setText] = useState(event ? event.description || '' : initial.text || '');
  const [media, setMedia] = useState(initial.media || null);
  const [when, setWhen] = useState(() => toLocalInput(
    event ? new Date(event.start.dateTime) : initial.when ? new Date(initial.when) : nextFullHour(),
  ));
  const [repeat, setRepeat] = useState(event ? repeatOf(event) : '');

  const [busy, setBusy] = useState(null); // which action is running
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // AI writing
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [styles, setStyles] = useState([]);
  const [styleId, setStyleId] = useState('');
  const [undoText, setUndoText] = useState(null);
  const textRef = useRef(null);

  useEffect(() => {
    Promise.all([
      api.get('/api/instagram/status').catch(() => ({ connected: false })),
      api.get('/api/telegram/status').catch(() => ({ connected: false, comingSoon: true })),
    ]).then(([instagram, telegram]) => setStatuses({ instagram, telegram }));
    api.get('/api/styles').then((rows) => setStyles(Array.isArray(rows) ? rows : [])).catch(() => {});
  }, []);

  // An existing post only carries its media id; look the file up to show it.
  useEffect(() => {
    if (!priv.mediaId) return;
    let cancelled = false;
    api.get('/api/media').then((data) => {
      const item = (data.items || []).find((i) => i.id === priv.mediaId);
      if (!cancelled && item) setMedia({ id: item.id, url: item.filePath, kind: item.kind });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [priv.mediaId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy && !pickerOpen && !templatesOpen) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, pickerOpen, templatesOpen, onClose]);

  // Telegram is only offered where it is switched on for this deployment.
  const offered = useMemo(() => {
    if (!statuses) return ['instagram'];
    return CHANNEL_KEYS.filter((k) => k === 'instagram' || !statuses[k]?.comingSoon);
  }, [statuses]);

  const isConnected = (k) => !!(statuses?.[k]?.connected && (k !== 'telegram' || statuses[k].chat));
  const handleOf = (k) => {
    const s = statuses?.[k];
    if (!s?.connected) return null;
    if (k === 'instagram') return s.username ? `@${s.username}` : s.accountName;
    return s.chat?.chatTitle || null;
  };

  const limit = Math.min(...channels.map((k) => limitFor(k)));
  const over = text.length > limit;
  const empty = !text.trim();
  const allConnected = channels.length > 0 && channels.every(isConnected);
  const notConnected = channels.filter((k) => statuses && !isConnected(k));
  const whenDate = new Date(when);

  // A message about what was wrong goes away as soon as the owner changes it.
  const [prevInputs, setPrevInputs] = useState({ text, media, channels, when });
  if (error && (prevInputs.text !== text || prevInputs.media !== media || prevInputs.channels !== channels || prevInputs.when !== when)) {
    setError('');
  }
  if (prevInputs.text !== text || prevInputs.media !== media || prevInputs.channels !== channels || prevInputs.when !== when) {
    setPrevInputs({ text, media, channels, when });
  }

  const toggleChannel = (k) => {
    if (mode !== 'create') return;
    setChannels((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]));
  };

  const fail = (err) => setError(err?.message || t('common.somethingWentWrong', 'Something went wrong'));

  const validate = (needsTime, needsMedia) => {
    if (!channels.length) { setError(t('postPanel.pickChannel', 'Pick where to post it.')); return false; }
    if (empty) { setError(t('postPanel.needText', 'Write something first.')); return false; }
    if (over) { setError(t('postPanel.tooLong', { defaultValue: 'That is {{n}} characters over the limit.', n: text.length - limit })); return false; }
    // Instagram has no text-only post: anything that will actually go out
    // there needs a photo or video. A draft can wait for one.
    if (needsMedia && channels.includes('instagram') && !media) {
      setError(t('postPanel.needMedia', 'Instagram posts need a photo or video. Add one, or save this as a draft.'));
      return false;
    }
    if (needsTime && isPast(whenDate)) { setError(t('postPanel.pastTime', 'Pick a time in the future.')); return false; }
    return true;
  };

  const save = async (kind) => {
    // kind: 'schedule' | 'draft' | 'now'
    if (busy) return;
    setError('');
    if (!validate(kind === 'schedule', kind !== 'draft')) return;
    setBusy(kind);
    try {
      if (mode === 'edit') {
        await api.patch(`/api/calendar/events/${event.id}`, {
          postText: text,
          mediaId: media?.id || null,
          start: { dateTime: whenDate.toISOString() },
          repeatRule: kind === 'draft' ? null : repeat || null,
          status: kind === 'draft' ? 'draft' : 'scheduled',
        });
      } else if (kind === 'now') {
        for (const k of channels) {
          await api.post('/api/content/post-now', { platform: k, postText: text.trim(), mediaId: media?.id || null });
        }
      } else {
        for (const k of channels) {
          await api.post('/api/content/schedule', {
            platform: k,
            postText: text,
            mediaId: media?.id || null,
            scheduledTime: whenDate.toISOString(),
            status: kind === 'draft' ? 'draft' : 'scheduled',
            repeatRule: kind === 'draft' ? undefined : repeat || undefined,
          });
        }
      }
      const day = dayLong(whenDate, lang);
      const time = timeOf(whenDate, lang);
      onSaved(kind === 'now'
        ? t('postPanel.postedNow', 'Posted.')
        : kind === 'draft'
          ? t('postPanel.savedDraft', 'Saved as a draft.')
          : t('postPanel.scheduledFor', { defaultValue: 'Scheduled for {{day}}, {{time}}.', day, time }));
    } catch (err) {
      fail(err);
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    setError('');
    try {
      await api.del(`/api/calendar/events/${event.id}`);
      onSaved(t('postPanel.deleted', 'Post deleted.'));
    } catch (err) {
      fail(err);
      setBusy(null);
    }
  };

  const runAi = async (instruction) => {
    const prompt = (instruction ?? aiPrompt).trim();
    if (!prompt || busy) return;
    setBusy('ai');
    setError('');
    try {
      const rewriting = !empty;
      const data = await api.post('/api/content/copywrite', {
        topic: rewriting ? '' : prompt,
        tone: activeProfile?.brandTone || activeProfile?.tone,
        businessName: activeProfile?.businessName,
        styleId: styleId || undefined,
        platform: channels[0] || 'instagram',
        ...(rewriting ? { previousText: text, feedback: prompt } : {}),
      });
      setUndoText(text);
      setText(data.post || '');
      setAiPrompt('');
      textRef.current?.focus();
    } catch (err) {
      fail(err);
    }
    setBusy(null);
  };

  const readOnly = mode === 'view';
  const title = mode === 'create'
    ? t('postPanel.newTitle', 'New post')
    : mode === 'edit'
      ? (status === 'draft' ? t('postPanel.draftTitle', 'Draft') : t('postPanel.scheduledTitle', 'Scheduled post'))
      : status === 'failed' ? t('postPanel.failedTitle', 'Post that failed') : t('postPanel.postedTitle', 'Posted');

  return (
    <div className="ui pp-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <aside className="pp" role="dialog" aria-modal="true" aria-labelledby="pp_title">
        <header className="pp-head">
          <h2 id="pp_title">{title}</h2>
          <button type="button" className="ui-icon-btn" onClick={onClose} disabled={!!busy} aria-label={t('common.close', 'Close')} id="btn_close_post_panel">
            <Icon name="close" />
          </button>
        </header>

        <div className="pp-body">
          {/* Where */}
          <div className="pp-field">
            <span className="ui-label">{t('postPanel.where', 'Post to')}</span>
            {mode === 'create' ? (
              <div className="pp-channels">
                {offered.map((k) => {
                  const on = channels.includes(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      className={`pp-channel${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() => toggleChannel(k)}
                      id={`btn_pp_channel_${k}`}
                    >
                      <ChannelMark channel={k} size={16} />
                      <span className="pp-channel-name">{channelInfo(k).label}</span>
                      <span className="pp-channel-sub">{handleOf(k) || t('postPanel.notConnected', 'Not connected')}</span>
                      {on && <span className="pp-channel-check"><Icon name="check" size={14} /></span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="pp-static">
                <ChannelMark channel={channels[0]} size={16} /> {channelInfo(channels[0]).label}
                {handleOf(channels[0]) && <span className="pp-muted"> · {handleOf(channels[0])}</span>}
              </p>
            )}
            {!readOnly && notConnected.length > 0 && (
              <p className="pp-note">
                {t('postPanel.connectNote', {
                  defaultValue: '{{channels}} isn’t connected yet. You can still save and schedule; it will go out once you connect it.',
                  channels: notConnected.map((k) => channelInfo(k).label).join(', '),
                })}{' '}
                {onGoToConnections && (
                  <button type="button" className="pp-link" onClick={onGoToConnections}>{t('postPanel.connect', 'Connect')}</button>
                )}
              </p>
            )}
          </div>

          {/* Text */}
          <div className="pp-field">
            <div className="pp-label-row">
              <label className="ui-label" htmlFor="inp_pp_text">{t('postPanel.text', 'Text')}</label>
              {!readOnly && (
                <span className={`pp-counter${over ? ' is-over' : ''}`}>{text.length} / {limit}</span>
              )}
            </div>
            {readOnly ? (
              <p className="pp-readonly-text">{text}</p>
            ) : (
              <textarea
                ref={textRef}
                id="inp_pp_text"
                className="ui-textarea pp-text"
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('postPanel.textPlaceholder', 'Write your post, or let AI write it for you.')}
                disabled={busy === 'ai'}
              />
            )}

            {!readOnly && (
              <div className="pp-tools">
                <button type="button" className={`ui-btn ui-btn-sm ${aiOpen ? 'ui-btn-outline' : 'ui-btn-quiet'}`} onClick={() => setAiOpen((v) => !v)} aria-expanded={aiOpen} id="btn_pp_ai">
                  <Icon name="sparkle" size={14} /> {empty ? t('postPanel.writeWithAi', 'Write with AI') : t('postPanel.changeWithAi', 'Change with AI')}
                </button>
                <button type="button" className="ui-btn ui-btn-quiet ui-btn-sm" onClick={() => setTemplatesOpen(true)} id="btn_pp_template">
                  <Icon name="template" size={14} /> {t('postPanel.template', 'Template')}
                </button>
                {!media && (
                  <button type="button" className="ui-btn ui-btn-quiet ui-btn-sm" onClick={() => setPickerOpen(true)} id="btn_pp_media">
                    <Icon name="image" size={14} /> {t('postPanel.addMedia', 'Photo or video')}
                  </button>
                )}
                {undoText !== null && (
                  <button type="button" className="ui-btn ui-btn-quiet ui-btn-sm pp-undo" onClick={() => { setText(undoText); setUndoText(null); }}>
                    {t('postPanel.undo', 'Undo')}
                  </button>
                )}
              </div>
            )}

            {!readOnly && aiOpen && (
              <div className="pp-ai">
                <label className="ui-label" htmlFor="inp_pp_ai">
                  {empty ? t('postPanel.aiAbout', 'What is the post about?') : t('postPanel.aiChange', 'What should change?')}
                </label>
                <div className="pp-ai-row">
                  <input
                    id="inp_pp_ai"
                    className="ui-input"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runAi(); } }}
                    placeholder={empty
                      ? t('postPanel.aiAboutPlaceholder', 'e.g. Free honey cake with every double espresso this weekend')
                      : t('postPanel.aiChangePlaceholder', 'e.g. Mention we open at 8')}
                    disabled={busy === 'ai'}
                  />
                  <button type="button" className="ui-btn ui-btn-primary" onClick={() => runAi()} disabled={!aiPrompt.trim() || !!busy} id="btn_pp_ai_run">
                    {busy === 'ai' ? <Icon name="spinner" size={14} /> : null}
                    {empty ? t('postPanel.aiWrite', 'Write') : t('postPanel.aiRewrite', 'Rewrite')}
                  </button>
                </div>
                {!empty && (
                  <div className="pp-chips">
                    {QUICK_CHANGES.map(([key, label, instruction]) => (
                      <button key={key} type="button" className="pp-chip" disabled={!!busy} onClick={() => runAi(instruction)}>
                        {t(`postPanel.quick.${key}`, label)}
                      </button>
                    ))}
                  </div>
                )}
                {styles.length > 0 && (
                  <div className="pp-ai-voice">
                    <label className="ui-label" htmlFor="sel_pp_voice">{t('postPanel.voice', 'Voice')}</label>
                    <select id="sel_pp_voice" className="ui-select" value={styleId} onChange={(e) => setStyleId(e.target.value)}>
                      <option value="">{t('postPanel.voiceDefault', 'Your brand voice')}</option>
                      {styles.map((s) => <option key={s.id} value={s.id}>{s.name || t('styles.untitled', 'Untitled style')}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Media */}
          {media && (
            <div className="pp-field">
              <span className="ui-label">{t('postPanel.media', 'Photo or video')}</span>
              <div className="pp-media">
                {media.kind === 'video'
                  ? <video src={api.mediaUrl(media.url)} muted controls />
                  : <img src={api.mediaUrl(media.url)} alt="" />}
                {!readOnly && (
                  <div className="pp-media-actions">
                    <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={() => setPickerOpen(true)}>{t('postPanel.replace', 'Replace')}</button>
                    <button type="button" className="ui-btn ui-btn-quiet ui-btn-sm" onClick={() => setMedia(null)}>{t('postPanel.remove', 'Remove')}</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* When */}
          <div className="pp-field pp-when">
            <div>
              <label className="ui-label" htmlFor="inp_pp_when">{readOnly ? t('postPanel.wentOut', 'Went out') : t('postPanel.when', 'When')}</label>
              {readOnly ? (
                <p className="pp-static">{dayLong(whenDate, lang)}, {timeOf(whenDate, lang)}</p>
              ) : (
                <input id="inp_pp_when" type="datetime-local" className="ui-input" value={when} onChange={(e) => setWhen(e.target.value)} />
              )}
            </div>
            {!readOnly && (
              <div>
                <label className="ui-label" htmlFor="sel_pp_repeat">{t('postPanel.repeat', 'Repeat')}</label>
                <select id="sel_pp_repeat" className="ui-select" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
                  <option value="">{t('postPanel.repeatNone', 'Don’t repeat')}</option>
                  <option value="daily">{t('postPanel.repeatDaily', 'Every day')}</option>
                  <option value="weekly">{t('postPanel.repeatWeekly', 'Every week')}</option>
                  <option value="monthly">{t('postPanel.repeatMonthly', 'Every month')}</option>
                </select>
              </div>
            )}
          </div>

          {error && <div className="ui-alert" role="alert">{error}</div>}
        </div>

        {/* Actions */}
        <footer className="pp-foot">
          {readOnly ? (
            <>
              <span className={`ui-badge ${status === 'failed' ? 'is-danger' : 'is-ok'}`}>
                {status === 'failed' ? t('posts.status.failed', 'Failed') : t('posts.status.posted', 'Posted')}
              </span>
              <button type="button" className="ui-btn ui-btn-outline" onClick={onClose}>{t('common.close', 'Close')}</button>
            </>
          ) : confirmDelete ? (
            <div className="pp-confirm">
              <span>{t('postPanel.deleteQuestion', 'Delete this post? This can’t be undone.')}</span>
              <div className="pp-confirm-actions">
                <button type="button" className="ui-btn ui-btn-quiet" onClick={() => setConfirmDelete(false)} disabled={!!busy}>{t('postPanel.keep', 'Keep it')}</button>
                <button type="button" className="ui-btn ui-btn-danger-solid" onClick={remove} disabled={!!busy} id="btn_pp_delete_confirm">
                  {busy === 'delete' && <Icon name="spinner" size={14} />} {t('postPanel.delete', 'Delete')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {mode === 'edit' && (
                <button type="button" className="ui-btn ui-btn-danger" onClick={() => setConfirmDelete(true)} disabled={!!busy} id="btn_pp_delete">
                  <Icon name="trash" size={15} /> {t('postPanel.delete', 'Delete')}
                </button>
              )}
              <div className="pp-foot-right">
                {mode === 'create' && allConnected && (
                  <button type="button" className="ui-btn ui-btn-quiet" onClick={() => save('now')} disabled={!!busy} id="btn_pp_post_now">
                    {busy === 'now' && <Icon name="spinner" size={14} />} {t('postPanel.postNow', 'Post now')}
                  </button>
                )}
                <button type="button" className="ui-btn ui-btn-outline" onClick={() => save('draft')} disabled={!!busy} id="btn_pp_draft">
                  {busy === 'draft' && <Icon name="spinner" size={14} />} {t('postPanel.saveDraft', 'Save draft')}
                </button>
                <button type="button" className="ui-btn ui-btn-primary" onClick={() => save('schedule')} disabled={!!busy} id="btn_pp_schedule">
                  {busy === 'schedule' && <Icon name="spinner" size={14} />}
                  {mode === 'edit' && status === 'scheduled' ? t('postPanel.save', 'Save') : t('postPanel.schedule', 'Schedule')}
                </button>
              </div>
            </>
          )}
        </footer>
      </aside>

      {pickerOpen && (
        <MediaLibraryPicker onSelect={(m) => { setMedia(m); setPickerOpen(false); }} onClose={() => setPickerOpen(false)} />
      )}
      {templatesOpen && (
        <TemplatesModal
          onClose={() => setTemplatesOpen(false)}
          onUseTemplate={(tplText, tplMedia) => {
            setUndoText(text);
            setText(tplText || '');
            if (tplMedia) setMedia(tplMedia);
            setTemplatesOpen(false);
          }}
        />
      )}
    </div>
  );
}
