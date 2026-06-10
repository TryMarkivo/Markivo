import { useState } from 'react';
import api from '../lib/api';
import './Onboarding.css';

/**
 * Guided Telegram setup. Telegram doesn't allow creating bots via API, so the
 * owner creates one in @BotFather (~60s, guided below); Markivo automates
 * everything after the token is pasted: branding the bot with the business
 * identity, detecting the channel, and publishing through Markiv.
 */
export default function TelegramConnect({ status, onStatusChange, onClose }) {
  const [botToken, setBotToken] = useState('');
  const [manualChat, setManualChat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const connected = !!status?.connected;
  const hasChat = !!status?.chat;

  const run = async (fn) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (err) {
      setError(err.message || 'Something went wrong');
    }
    setBusy(false);
  };

  const handleConnect = () =>
    run(async () => {
      const data = await api.post('/api/telegram/connect', { botToken: botToken.trim() });
      setNotice(`Bot @${data.botUsername} connected and branded with your business identity ✓`);
      setBotToken('');
      onStatusChange?.();
    });

  const handleDetect = () =>
    run(async () => {
      const data = await api.post('/api/telegram/detect-chat', {});
      setNotice(`Linked to "${data.chat.chatTitle}" ✓`);
      onStatusChange?.();
    });

  const handleManualChat = () =>
    run(async () => {
      const data = await api.post('/api/telegram/channel', { chat: manualChat.trim() });
      setNotice(`Linked to "${data.chat.chatTitle}" ✓`);
      setManualChat('');
      onStatusChange?.();
    });

  return (
    <div className="auth-overlay animate-fade-in" id="telegram_connect_modal">
      <div className="auth-card glass-card glass-card-glow text-left" style={{ maxWidth: 560 }}>
        <div className="auth-header flex-between mb-20">
          <h3><i className="fa-brands fa-telegram" style={{ color: '#2AABEE' }}></i> Telegram Setup</h3>
          <button className="btn-close" onClick={onClose} id="btn_close_telegram">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {error && <div className="auth-error-box mb-20">{error}</div>}
        {notice && <div className="badge badge-success mb-20" style={{ display: 'block', padding: 10 }}>{notice}</div>}

        {/* STEP 1 — create bot & paste token */}
        {!connected && (
          <div className="step-content">
            <h4 className="mb-10">Step 1 of 2 — Create your business bot (~1 minute)</h4>
            <ol style={{ lineHeight: 1.9, paddingLeft: 20, marginBottom: 16 }}>
              <li>Open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="link-text">@BotFather</a> in Telegram</li>
              <li>Send <code>/newbot</code> and follow the two prompts</li>
              <li>Copy the <strong>API token</strong> BotFather gives you and paste it below</li>
            </ol>
            <p className="text-muted mb-20" style={{ fontSize: 13 }}>
              <i className="fa-solid fa-wand-magic-sparkles"></i> Once you paste the token, Markivo automatically
              brands the bot with your business name, description, and slogan.
            </p>

            <div className="form-group">
              <label className="form-label" htmlFor="inp_bot_token">Bot API Token</label>
              <input
                type="text"
                id="inp_bot_token"
                className="input-field"
                placeholder="e.g. 1234567890:ABCdefGhIJKlmNoPQRstuVWxyZ..."
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
              />
            </div>
            <button className="btn btn-primary w-full" onClick={handleConnect} disabled={busy || !botToken.trim()} id="btn_tg_connect">
              {busy ? 'Connecting & branding your bot…' : 'Connect & Brand My Bot ✦'}
            </button>
          </div>
        )}

        {/* STEP 2 — link channel/group */}
        {connected && !hasChat && (
          <div className="step-content">
            <h4 className="mb-10">Step 2 of 2 — Link your channel or group</h4>
            <p className="mb-20">
              Add <strong>@{status.botUsername}</strong> to your Telegram channel as an
              <strong> administrator</strong> (with “Post messages” permission), or to your group as a member.
              Then click detect:
            </p>
            <button className="btn btn-primary w-full mb-20" onClick={handleDetect} disabled={busy} id="btn_tg_detect">
              {busy ? 'Looking for your channel…' : '🔍 Detect My Channel'}
            </button>

            <div className="form-group border-top-onboard pt-20">
              <label className="form-label" htmlFor="inp_tg_chat">Or enter it manually</label>
              <div className="flex-gap-8">
                <input
                  type="text"
                  id="inp_tg_chat"
                  className="input-field"
                  placeholder="@yourchannel"
                  value={manualChat}
                  onChange={(e) => setManualChat(e.target.value)}
                />
                <button className="btn btn-secondary" onClick={handleManualChat} disabled={busy || !manualChat.trim()} id="btn_tg_manual">
                  Link
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DONE */}
        {connected && hasChat && (
          <div className="step-content text-center">
            <i className="fa-solid fa-circle-check fa-3x text-success mb-20" style={{ display: 'block' }}></i>
            <h4>Telegram is fully connected!</h4>
            <p className="mt-10">
              Bot <strong>@{status.botUsername}</strong> posts to{' '}
              <strong>{status.chat.chatTitle}</strong> ({status.chat.chatType}).
            </p>
            <p className="text-muted mt-10">
              Now just tell <strong>Markiv</strong> in the chat panel: <em>“Post our weekend offer to Telegram”</em> —
              you approve, it publishes. 🚀
            </p>
            <button className="btn btn-primary mt-20" onClick={onClose} id="btn_tg_done">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
