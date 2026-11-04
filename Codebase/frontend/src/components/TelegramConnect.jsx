import { useCallback, useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import api from '../lib/api';
import Icon, { ChannelMark } from './ui/Icon';
import './TelegramConnect.css';

const POLL_MS = 3000;

/**
 * Telegram setup. Two ways in:
 *  - the Markivo bot (offered whenever the server has one): open a link,
 *    press Start, pick the channel. Telegram adds the bot as admin and the
 *    server links the channel; this window watches status until it appears.
 *  - the business's own bot: create one in @BotFather and paste its token.
 */
export default function TelegramConnect({ status, onStatusChange, onClose }) {
  const { t } = useTranslation();
  const [live, setLive] = useState(null); // fresher status than the prop
  const st = live || status || {};
  const sharedAvailable = !!st.sharedAvailable;
  const done = !!st.connected && !!st.chat;

  // 'shared' | 'own', picked by the owner; until then the Markivo bot when the
  // server has one, unless the owner already connected a bot of their own.
  const [viewPick, setView] = useState(null);
  const view = viewPick || (sharedAvailable && !(st.connected && st.mode !== 'shared') ? 'shared' : 'own');
  const [changing, setChanging] = useState(false); // connected, picking another channel
  const [link, setLink] = useState(null); // { url, botUsername }
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [botToken, setBotToken] = useState('');
  const [manualChat, setManualChat] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);

  const showForm = !done || changing;
  const sharedFlow = showForm && view === 'shared' && sharedAvailable;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const refresh = useCallback(async () => {
    const s = await api.get('/api/telegram/status');
    setLive(s);
    return s;
  }, []);

  // The prop can be stale (or still loading): read the status once on open.
  useEffect(() => {
    let off = false;
    api.get('/api/telegram/status').then((s) => { if (!off) setLive(s); }).catch(() => {});
    return () => { off = true; };
  }, []);

  const getLink = useCallback(async () => {
    setError('');
    try {
      setLink(await api.post('/api/telegram/link/start', {}));
      setOpened(false);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
  }, [t]);

  // A fresh one-time link whenever the shared flow is on screen without one.
  // A failure leaves `link` empty and shows "Try again" (no retry loop).
  useEffect(() => {
    if (!sharedFlow || link) return undefined;
    let off = false;
    api.post('/api/telegram/link/start', {})
      .then((l) => { if (!off) { setLink(l); setOpened(false); } })
      .catch((err) => { if (!off) setError(err.message || t('common.somethingWentWrong', 'Something went wrong')); });
    return () => { off = true; };
  }, [sharedFlow, link, t]);

  // While the owner is in Telegram, watch for the channel to appear.
  useEffect(() => {
    if (!sharedFlow || !link) return undefined;
    const startedAt = st.chat?.chatId || null;
    const timer = setInterval(async () => {
      try {
        const s = await refresh();
        if (s.connected && s.chat && s.mode === 'shared' && s.chat.chatId !== startedAt) {
          setChanging(false);
          setLink(null);
          onStatusChange?.();
        }
      } catch { /* try again on the next tick */ }
    }, POLL_MS);
    return () => clearInterval(timer);
    // st.chat is read once per link on purpose: it is the channel before this link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedFlow, link, refresh, onStatusChange]);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
      onStatusChange?.();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setBusy(false);
  };

  const connectOwn = () => run(async () => {
    await api.post('/api/telegram/connect', { botToken: botToken.trim() });
    setBotToken('');
  });
  const detect = () => run(() => api.post('/api/telegram/detect-chat', {}));
  const linkManual = () => run(async () => {
    await api.post('/api/telegram/channel', { chat: manualChat.trim() });
    setManualChat('');
    setChanging(false);
  });
  const disconnect = () => run(async () => {
    await api.post('/api/connect/telegram/disconnect', {});
    setConfirmOff(false);
    setChanging(false);
    setLink(null);
    setOpened(false);
  });

  const switchTo = (next) => {
    setError('');
    setView(next);
  };

  const ownHasBot = !!st.connected && st.mode !== 'shared' && !st.chat;
  const chatType = st.chat ? t(`telegram.chatTypes.${st.chat.chatType}`, st.chat.chatType) : '';

  return (
    <div
      className="auth-overlay tg-scrim"
      id="telegram_connect_modal"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="tg-dialog" role="dialog" aria-modal="true" aria-labelledby="telegram_modal_title">
        <div className="tg-head">
          <h2 id="telegram_modal_title"><ChannelMark channel="telegram" size={18} /> {t('telegram.setupTitle', 'Connect Telegram')}</h2>
          <button type="button" className="ui-icon-btn" onClick={onClose} id="btn_close_telegram" aria-label={t('common.close', 'Close')}>
            <Icon name="close" />
          </button>
        </div>

        <div className="tg-body">
          {error && <div className="ui-alert" role="alert">{error}</div>}

          {/* CONNECTED */}
          {done && !changing && (
            <>
              <div className="tg-done">
                <span className="tg-done-mark"><Icon name="check" size={18} /></span>
                <div>
                  <p className="tg-done-title">{st.chat.chatTitle}</p>
                  <p className="tg-muted">
                    {st.mode === 'shared'
                      ? t('telegram.doneShared', { defaultValue: '{{chatType}} · posts go out under the channel’s name', chatType })
                      : t('telegram.doneOwn', { defaultValue: '{{chatType}} · through your bot @{{username}}', chatType, username: st.botUsername })}
                  </p>
                </div>
              </div>
              <p className="tg-muted">{t('telegram.doneHint2', 'Scheduled Telegram posts in your calendar now go out to this channel.')}</p>

              {confirmOff ? (
                <div className="tg-confirm">
                  <span>{t('telegram.disconnectConfirm', 'Disconnect Telegram? Scheduled Telegram posts will wait until you connect again.')}</span>
                  <div className="tg-row">
                    <button type="button" className="ui-btn ui-btn-outline" onClick={() => setConfirmOff(false)} disabled={busy}>{t('common.cancel', 'Cancel')}</button>
                    <button type="button" className="ui-btn ui-btn-danger-solid" onClick={disconnect} disabled={busy} id="btn_tg_disconnect_confirm">{t('telegram.disconnect', 'Disconnect')}</button>
                  </div>
                </div>
              ) : (
                <div className="tg-row tg-actions">
                  <button type="button" className="ui-btn ui-btn-danger" onClick={() => setConfirmOff(true)} id="btn_tg_disconnect">{t('telegram.disconnect', 'Disconnect')}</button>
                  {sharedAvailable && (
                    <button type="button" className="ui-btn ui-btn-outline" onClick={() => { setView('shared'); setChanging(true); }} id="btn_tg_change">
                      {t('telegram.changeChannel', 'Change channel')}
                    </button>
                  )}
                  <button type="button" className="ui-btn ui-btn-primary tg-push" onClick={onClose} id="btn_tg_done">{t('common.done', 'Done')}</button>
                </div>
              )}
            </>
          )}

          {/* MARKIVO BOT */}
          {sharedFlow && (
            <>
              <ol className="tg-steps">
                <li>{t('telegram.shared.step1', 'Open Telegram and press Start.')}</li>
                <li>{t('telegram.shared.step2', 'Choose your channel. Telegram adds the Markivo bot to it as an admin.')}</li>
              </ol>

              {link ? (
                <a
                  className="ui-btn ui-btn-primary tg-big tg-open"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setOpened(true)}
                  id="btn_tg_open"
                >
                  <Icon name="send" /> {t('telegram.shared.open', 'Open Telegram')}
                </a>
              ) : error ? (
                <button type="button" className="ui-btn ui-btn-outline tg-big tg-open" onClick={getLink}>
                  {t('common.tryAgain', 'Try again')}
                </button>
              ) : (
                <button type="button" className="ui-btn ui-btn-primary tg-big tg-open" disabled>
                  <Icon name="spinner" className="ui-spin" /> {t('telegram.shared.preparing', 'Preparing your link…')}
                </button>
              )}

              {(opened || st.linking?.opened) && (
                <div className="tg-wait" role="status">
                  <Icon name="spinner" className="ui-spin" />
                  <span>
                    {st.linking?.opened
                      ? t('telegram.shared.pickNow', 'Now choose your channel in Telegram.')
                      : t('telegram.shared.waiting', 'Waiting for you to press Start in Telegram…')}
                  </span>
                  <button type="button" className="tg-link tg-push" onClick={getLink}>{t('telegram.shared.newLink', 'New link')}</button>
                </div>
              )}

              <div className="tg-foot">
                {link && <span className="tg-muted">{t('telegram.shared.botName', { defaultValue: 'Bot: @{{username}}', username: link.botUsername })}</span>}
                {changing
                  ? <button type="button" className="tg-link tg-push" onClick={() => { setChanging(false); setLink(null); }}>{t('common.cancel', 'Cancel')}</button>
                  : <button type="button" className="tg-link tg-push" onClick={() => switchTo('own')} id="btn_tg_own">{t('telegram.useOwnBot', 'Use my own bot instead')}</button>}
              </div>
            </>
          )}

          {/* OWN BOT — step 1: token */}
          {showForm && !sharedFlow && !ownHasBot && (
            <>
              <ol className="tg-steps">
                {/* One <span> per step: the step's text and its links stay one grid cell. */}
                <li>
                  <span>
                    <Trans
                      i18nKey="telegram.step1Item1"
                      defaults="Open <1>@BotFather</1> in Telegram"
                      components={{ 1: <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="tg-link" /> }}
                    />
                  </span>
                </li>
                <li><span><Trans i18nKey="telegram.step1Item2" defaults="Send <1>/newbot</1> and answer its two questions" components={{ 1: <code /> }} /></span></li>
                <li><span><Trans i18nKey="telegram.step1Item3" defaults="Copy the <1>token</1> BotFather sends you and paste it below" components={{ 1: <strong /> }} /></span></li>
              </ol>
              <div>
                <label className="ui-label" htmlFor="inp_bot_token">{t('telegram.botTokenLabel', 'Bot token')}</label>
                <input
                  type="text"
                  id="inp_bot_token"
                  className="ui-input"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('telegram.botTokenPlaceholder', 'e.g. 1234567890:ABCdefGhIJKlmNoPQRstuVWxyZ...')}
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                />
              </div>
              <button type="button" className="ui-btn ui-btn-primary tg-big" onClick={connectOwn} disabled={busy || !botToken.trim()} id="btn_tg_connect">
                {busy ? t('telegram.connecting', 'Connecting and setting up your bot…') : t('telegram.connectCta', 'Connect my bot')}
              </button>
              {sharedAvailable && (
                <div className="tg-foot">
                  <button type="button" className="tg-link tg-push" onClick={() => switchTo('shared')} id="btn_tg_shared">{t('telegram.useShared', 'Use the Markivo bot instead')}</button>
                </div>
              )}
            </>
          )}

          {/* OWN BOT — step 2: channel */}
          {showForm && !sharedFlow && ownHasBot && (
            <>
              <p>
                <Trans
                  i18nKey="telegram.step2Text"
                  defaults='Add <1>@{{username}}</1> to your channel as an <3>admin</3> with the "Post messages" permission, or to your group as a member. Then press the button below.'
                  values={{ username: st.botUsername }}
                  components={{ 1: <strong />, 3: <strong /> }}
                />
              </p>
              <button type="button" className="ui-btn ui-btn-primary tg-big" onClick={detect} disabled={busy} id="btn_tg_detect">
                {busy ? t('telegram.detecting', 'Looking for your channel…') : t('telegram.detectCta', 'Find my channel')}
              </button>
              <div>
                <label className="ui-label" htmlFor="inp_tg_chat">{t('telegram.manualLabel', 'Or type it in')}</label>
                <div className="tg-row">
                  <input
                    type="text"
                    id="inp_tg_chat"
                    className="ui-input"
                    placeholder={t('telegram.manualPlaceholder', '@yourchannel')}
                    value={manualChat}
                    onChange={(e) => setManualChat(e.target.value)}
                  />
                  <button type="button" className="ui-btn ui-btn-outline" onClick={linkManual} disabled={busy || !manualChat.trim()} id="btn_tg_manual">
                    {t('telegram.linkCta', 'Link')}
                  </button>
                </div>
              </div>
              {sharedAvailable && (
                <div className="tg-foot">
                  <button type="button" className="tg-link tg-push" onClick={() => switchTo('shared')}>{t('telegram.useShared', 'Use the Markivo bot instead')}</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
