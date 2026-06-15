import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import api from '../lib/api';
import './Onboarding.css';

/**
 * Guided Telegram setup. Telegram doesn't allow creating bots via API, so the
 * owner creates one in @BotFather (~60s, guided below); Markivo automates
 * everything after the token is pasted: branding the bot with the business
 * identity, detecting the channel, and publishing through Markiv.
 */
export default function TelegramConnect({ status, onStatusChange, onClose }) {
  const { t } = useTranslation();
  const [botToken, setBotToken] = useState('');
  const [manualChat, setManualChat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const connected = !!status?.connected;
  const hasChat = !!status?.chat;

  // Close on Escape for keyboard accessibility.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setBusy(false);
  };

  const handleConnect = () =>
    run(async () => {
      const data = await api.post('/api/telegram/connect', { botToken: botToken.trim() });
      setNotice(t('telegram.connectedNotice', {
        defaultValue: 'Bot @{{username}} connected and branded with your business identity ✓',
        username: data.botUsername
      }));
      setBotToken('');
      onStatusChange?.();
    });

  const handleDetect = () =>
    run(async () => {
      const data = await api.post('/api/telegram/detect-chat', {});
      setNotice(t('telegram.linkedNotice', { defaultValue: 'Linked to "{{chatTitle}}" ✓', chatTitle: data.chat.chatTitle }));
      onStatusChange?.();
    });

  const handleManualChat = () =>
    run(async () => {
      const data = await api.post('/api/telegram/channel', { chat: manualChat.trim() });
      setNotice(t('telegram.linkedNotice', { defaultValue: 'Linked to "{{chatTitle}}" ✓', chatTitle: data.chat.chatTitle }));
      setManualChat('');
      onStatusChange?.();
    });

  return (
    <div
      className="auth-overlay animate-fade-in"
      id="telegram_connect_modal"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="auth-card glass-card glass-card-glow text-left" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-labelledby="telegram_modal_title">
        <div className="auth-header flex-between mb-20">
          <h3 id="telegram_modal_title"><i className="fa-brands fa-telegram" style={{ color: 'var(--tg-blue)' }}></i> {t('telegram.setupTitle', 'Telegram Setup')}</h3>
          <button className="btn-close" onClick={onClose} id="btn_close_telegram" aria-label={t('common.close', 'Close')}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {error && <div className="auth-error-box mb-20" role="alert">{error}</div>}
        {notice && <div className="badge badge-success mb-20" style={{ display: 'block', padding: 10 }} role="status">{notice}</div>}

        {/* STEP 1 — create bot & paste token */}
        {!connected && (
          <div className="step-content">
            <h4 className="mb-10">{t('telegram.step1Title', 'Step 1 of 2 — Create your business bot (~1 minute)')}</h4>
            <ol style={{ lineHeight: 1.9, paddingLeft: 20, marginBottom: 16 }}>
              <li>
                <Trans
                  i18nKey="telegram.step1Item1"
                  defaults="Open <1>@BotFather</1> in Telegram"
                  components={{ 1: <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="link-text" /> }}
                />
              </li>
              <li>
                <Trans
                  i18nKey="telegram.step1Item2"
                  defaults="Send <1>/newbot</1> and follow the two prompts"
                  components={{ 1: <code /> }}
                />
              </li>
              <li>
                <Trans
                  i18nKey="telegram.step1Item3"
                  defaults="Copy the <1>API token</1> BotFather gives you and paste it below"
                  components={{ 1: <strong /> }}
                />
              </li>
            </ol>
            <p className="text-muted mb-20" style={{ fontSize: 13 }}>
              <i className="fa-solid fa-wand-magic-sparkles"></i>{' '}
              {t('telegram.step1Note', 'Once you paste the token, Markivo automatically brands the bot with your business name, description, and slogan.')}
            </p>

            <div className="form-group">
              <label className="form-label" htmlFor="inp_bot_token">{t('telegram.botTokenLabel', 'Bot API Token')}</label>
              <input
                type="text"
                id="inp_bot_token"
                className="input-field"
                placeholder={t('telegram.botTokenPlaceholder', 'e.g. 1234567890:ABCdefGhIJKlmNoPQRstuVWxyZ...')}
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
              />
            </div>
            <button className="btn btn-primary w-full" onClick={handleConnect} disabled={busy || !botToken.trim()} id="btn_tg_connect">
              {busy ? t('telegram.connecting', 'Connecting & branding your bot…') : t('telegram.connectCta', 'Connect & Brand My Bot ✦')}
            </button>
          </div>
        )}

        {/* STEP 2 — link channel/group */}
        {connected && !hasChat && (
          <div className="step-content">
            <h4 className="mb-10">{t('telegram.step2Title', 'Step 2 of 2 — Link your channel or group')}</h4>
            <p className="mb-20">
              <Trans
                i18nKey="telegram.step2Text"
                defaults='Add <1>@{{username}}</1> to your Telegram channel as an <3>administrator</3> (with "Post messages" permission), or to your group as a member. Then click detect:'
                values={{ username: status.botUsername }}
                components={{ 1: <strong />, 3: <strong /> }}
              />
            </p>
            <button className="btn btn-primary w-full mb-20" onClick={handleDetect} disabled={busy} id="btn_tg_detect">
              {busy ? t('telegram.detecting', 'Looking for your channel…') : t('telegram.detectCta', '🔍 Detect My Channel')}
            </button>

            <div className="form-group border-top-onboard pt-20">
              <label className="form-label" htmlFor="inp_tg_chat">{t('telegram.manualLabel', 'Or enter it manually')}</label>
              <div className="flex-gap-8">
                <input
                  type="text"
                  id="inp_tg_chat"
                  className="input-field"
                  placeholder={t('telegram.manualPlaceholder', '@yourchannel')}
                  value={manualChat}
                  onChange={(e) => setManualChat(e.target.value)}
                />
                <button className="btn btn-secondary" onClick={handleManualChat} disabled={busy || !manualChat.trim()} id="btn_tg_manual">
                  {t('telegram.linkCta', 'Link')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DONE */}
        {connected && hasChat && (
          <div className="step-content text-center">
            <i className="fa-solid fa-circle-check fa-3x text-success mb-20" style={{ display: 'block' }}></i>
            <h4>{t('telegram.doneTitle', 'Telegram is fully connected!')}</h4>
            <p className="mt-10">
              <Trans
                i18nKey="telegram.doneText"
                defaults="Bot <1>@{{username}}</1> posts to <3>{{chatTitle}}</3> ({{chatType}})."
                values={{
                  username: status.botUsername,
                  chatTitle: status.chat.chatTitle,
                  chatType: t(`telegram.chatTypes.${status.chat.chatType}`, status.chat.chatType)
                }}
                components={{ 1: <strong />, 3: <strong /> }}
              />
            </p>
            <p className="text-muted mt-10">
              <Trans
                i18nKey="telegram.doneHint"
                defaults='Now just tell <1>Markiv</1> in the chat panel: <3>"Post our weekend offer to Telegram"</3> — you approve, it publishes. 🚀'
                components={{ 1: <strong />, 3: <em /> }}
              />
            </p>
            <button className="btn btn-primary mt-20" onClick={onClose} id="btn_tg_done">{t('common.done', 'Done')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
