import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import api from '../lib/api';
import './Onboarding.css';

/**
 * Instagram (Meta) connect modal. Simpler than Telegram — there are no manual
 * steps: the single button fetches an authenticated OAuth URL from the backend
 * and sends the browser to Meta's auth dialog. Meta redirects back to the
 * backend callback (which stores the token) and then to the dashboard, where a
 * ?instagram=connected param surfaces the result.
 */
export default function InstagramConnect({ status, onStatusChange, onClose }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const connected = !!status?.connected;
  const handle = status?.username ? `@${status.username}` : status?.accountName;

  // Close on Escape for keyboard accessibility.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleConnect = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api.get('/api/instagram/connect');
      // Full-page redirect to Meta's auth dialog. The SPA's localStorage token
      // survives the round trip back to this same origin.
      window.location.href = data.authUrl;
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/api/instagram/disconnect', {});
      onStatusChange?.();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setBusy(false);
  };

  return (
    <div
      className="auth-overlay animate-fade-in"
      id="instagram_connect_modal"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="auth-card glass-card glass-card-glow text-left" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-labelledby="instagram_modal_title">
        <div className="auth-header flex-between mb-20">
          <h3 id="instagram_modal_title">
            <i className="fa-brands fa-instagram" style={{ color: '#E1306C' }}></i> {t('instagram.setupTitle', 'Connect Instagram')}
          </h3>
          <button className="btn-close" onClick={onClose} id="btn_close_instagram" aria-label={t('common.close', 'Close')}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {error && <div className="auth-error-box mb-20" role="alert">{error}</div>}

        {!connected && (
          <div className="step-content">
            <p className="mb-20">
              {t('instagram.intro', 'Connect your Instagram Business account so Markivo can publish on your behalf. You\'ll be taken to Meta to authorize — it takes about a minute.')}
            </p>
            <ol style={{ lineHeight: 1.9, paddingLeft: 20, marginBottom: 16 }}>
              <li>{t('instagram.step1', 'Click the button below — we send you to Meta\'s secure login.')}</li>
              <li>{t('instagram.step2', 'Choose the Facebook Page linked to your Instagram Business account and approve access.')}</li>
              <li>{t('instagram.step3', 'You\'ll land back here, connected. ✓')}</li>
            </ol>
            <p className="text-muted mb-20" style={{ fontSize: 13 }}>
              <i className="fa-solid fa-circle-info"></i>{' '}
              <Trans
                i18nKey="instagram.requirement"
                defaults="Your Instagram must be a <1>Business or Creator</1> account linked to a Facebook Page."
                components={{ 1: <strong /> }}
              />
            </p>
            <button className="btn btn-primary w-full" onClick={handleConnect} disabled={busy} id="btn_ig_connect">
              {busy ? t('instagram.connecting', 'Redirecting to Meta…') : t('instagram.connectCta', 'Connect Instagram ✦')}
            </button>
          </div>
        )}

        {connected && (
          <div className="step-content text-center">
            <i className="fa-solid fa-circle-check fa-3x text-success mb-20" style={{ display: 'block' }}></i>
            <h4>{t('instagram.doneTitle', 'Instagram is connected!')}</h4>
            <p className="mt-10">
              <Trans
                i18nKey="instagram.doneText"
                defaults="Connected as <1>{{handle}}</1>."
                values={{ handle: handle || t('instagram.yourAccount', 'your account') }}
                components={{ 1: <strong /> }}
              />
            </p>
            <button className="btn btn-secondary mt-20" onClick={handleDisconnect} disabled={busy} id="btn_ig_disconnect">
              {busy ? t('common.working', 'Working…') : t('instagram.disconnectCta', 'Disconnect')}
            </button>
            <button className="btn btn-primary mt-20 ml-10" onClick={onClose} id="btn_ig_done">{t('common.done', 'Done')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
