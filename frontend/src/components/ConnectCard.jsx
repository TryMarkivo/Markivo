import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import './Onboarding.css';

/**
 * Generic connect modal for any non-Telegram platform connector (Instagram,
 * Facebook, TikTok, Google Business, YouTube). LIVE platforms (real OAuth
 * credentials configured) redirect to the platform's consent screen; SANDBOX
 * platforms connect inline so the flow works fully keyless. The compliance
 * model is shown to the owner: Markivo posts on their behalf through the
 * official API, behind approval — it never logs into their account.
 */
export default function ConnectCard({ platform, status, meta, onChanged, onClose }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const connected = !!status?.connected;
  const sandbox = !!status?.sandbox && connected;
  const live = !!status?.live;
  const comingSoon = !!status?.comingSoon;
  // Connect guidance travels with the platform from /api/connect/status, so
  // this modal explains any platform without hardcoding per-platform copy.
  const requirements = platform.requirements || [];
  const steps = platform.howToConnect || [];
  // Telegram-style platforms are connected with a pasted token, not OAuth —
  // there is no button to press here, only instructions.
  const tokenAuth = platform.authType === 'token';

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (fn) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (err) { setError(err.message || t('common.somethingWentWrong', 'Something went wrong')); }
    setBusy(false);
  };

  const handleConnect = () => run(async () => {
    const data = await api.post(`/api/connect/${platform.key}/start`, {});
    if (data.mode === 'oauth' && data.url) {
      // Hand off to the platform's OAuth consent screen; we return via the callback.
      window.location.href = data.url;
      return;
    }
    setNotice(t('connections.sandboxConnected', { defaultValue: '{{label}} connected in sandbox mode ✓', label: platform.label }));
    onChanged?.();
  });

  const handleDisconnect = () => run(async () => {
    await api.post(`/api/connect/${platform.key}/disconnect`, {});
    setNotice(t('connections.disconnected', { defaultValue: '{{label}} disconnected', label: platform.label }));
    onChanged?.();
  });

  return (
    <div className="auth-overlay animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="auth-card panel text-left" style={{ maxWidth: 520 }} role="dialog" aria-modal="true" aria-labelledby="connect_modal_title">
        <div className="auth-header flex-between mb-20">
          <h3 id="connect_modal_title"><i className={meta.icon} style={{ color: meta.color }}></i>{' '}
            {t('connections.setupTitle', { defaultValue: 'Connect {{label}}', label: platform.label })}</h3>
          <button className="btn-close" onClick={onClose} aria-label={t('common.close', 'Close')}><i className="fa-solid fa-xmark"></i></button>
        </div>

        {error && <div className="auth-error-box mb-20" role="alert">{error}</div>}
        {notice && <div className="badge badge-success mb-20" style={{ display: 'block', padding: 10 }} role="status">{notice}</div>}

        <p className="text-muted mb-20" style={{ fontSize: 13 }}>
          <i className="fa-solid fa-shield-halved"></i>{' '}
          {t('connections.howItWorks', { defaultValue: 'Markivo publishes to {{label}} on your behalf through its official API, and every post goes through your approval first — it never logs into your account.', label: platform.label })}
        </p>

        {!connected && (
          <div className="step-content">
            {requirements.length > 0 && (
              <div className="connect-requirements">
                <h5>{t('connections.requirementsTitle', 'What you need first')}</h5>
                <ul>
                  {requirements.map((req, i) => (
                    <li key={i}><i className="fa-solid fa-circle-check"></i> {req}</li>
                  ))}
                </ul>
              </div>
            )}

            {steps.length > 0 && (
              <div className="connect-steps">
                <h5>{t('connections.howToTitle', 'How to connect')}</h5>
                <ol>
                  {steps.map((step, i) => <li key={i}>{step}</li>)}
                </ol>
                {platform.docsUrl && (
                  <a className="connect-docs-link" href={platform.docsUrl} target="_blank" rel="noreferrer">
                    <i className="fa-solid fa-arrow-up-right-from-square"></i>{' '}
                    {t('connections.officialDocs', 'Official documentation')}
                  </a>
                )}
              </div>
            )}

            {comingSoon && (
              <div className="badge badge-primary mb-20" style={{ display: 'block', padding: 10 }} role="status">
                <i className="fa-solid fa-clock"></i>{' '}
                {t('connections.comingSoonNote', { defaultValue: '{{label}} is not switched on yet — these are the steps for when it is.', label: platform.label })}
              </div>
            )}

            {!live && !comingSoon && (
              <div className="mb-20" style={{ padding: 10, borderRadius: 8, fontSize: 13, background: 'var(--surface-2, rgba(245,158,11,.08))', border: '1px solid var(--border-subtle, rgba(245,158,11,.3))' }}>
                <i className="fa-solid fa-flask"></i>{' '}
                {t('connections.sandboxNote', 'Sandbox mode — no live credentials are configured for this platform yet, so connecting simulates the flow (no real posts go out). Add the platform’s API keys to switch this to live.')}
              </div>
            )}
            {!tokenAuth && !comingSoon && (
              <button className="btn btn-primary w-full" onClick={handleConnect} disabled={busy} id={`btn_connect_${platform.key}`}>
                {busy
                  ? t('connections.connecting', 'Connecting…')
                  : live
                    ? t('connections.connectLiveCta', { defaultValue: 'Connect {{label}} →', label: platform.label })
                    : t('connections.connectSandboxCta', { defaultValue: 'Connect {{label}} (sandbox)', label: platform.label })}
              </button>
            )}
          </div>
        )}

        {connected && (
          <div className="step-content">
            <p className="mb-20">
              <i className="fa-solid fa-circle-check text-success"></i>{' '}
              {sandbox ? t('connections.statusSandbox', 'Connected (sandbox)') : t('connections.statusConnected', 'Connected')}
              {status.accountHandle ? ` · ${status.accountHandle}` : ''}
            </p>
            <p className="text-muted mb-20" style={{ fontSize: 13 }}>
              {t('connections.connectedHint', { defaultValue: 'Ask Markiv in the chat panel to post to {{label}} — you approve, it publishes.', label: platform.label })}
            </p>
            <button className="btn btn-secondary w-full" onClick={handleDisconnect} disabled={busy} id={`btn_disconnect_${platform.key}`}>
              {busy ? t('connections.working', 'Working…') : t('connections.disconnectCta', 'Disconnect')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
