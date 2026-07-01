import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import ConnectCard from './ConnectCard';
import TelegramConnect from './TelegramConnect';
import './Connections.css';

// Visual meta per platform key (icon + brand colour). The SERVER is the source
// of truth for which platforms exist (via /api/connect/status); this map only
// styles the ones it returns, with a generic fallback for anything new.
const META = {
  telegram: { icon: 'fa-brands fa-telegram', color: 'var(--tg-blue, #229ED9)' },
  meta_instagram: { icon: 'fa-brands fa-instagram', color: '#E1306C' },
  meta_facebook: { icon: 'fa-brands fa-facebook', color: '#1877F2' },
  tiktok: { icon: 'fa-brands fa-tiktok', color: 'var(--text-primary, #111)' },
  google_business: { icon: 'fa-brands fa-google', color: '#4285F4' },
  youtube: { icon: 'fa-brands fa-youtube', color: '#FF0000' },
};
const FALLBACK_META = { icon: 'fa-solid fa-share-nodes', color: 'var(--accent-primary)' };

/**
 * Dashboard "Connections" tab. Lists every platform the connector framework
 * exposes with its live/sandbox/connected state, and opens the right connect
 * flow — Telegram keeps its dedicated guided modal; everything else uses the
 * generic ConnectCard (OAuth when live, simulated when sandbox).
 */
export default function ConnectionsPanel({ activeProfile }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null); // { catalogue, status }
  const [tgStatus, setTgStatus] = useState(null);
  const [openKey, setOpenKey] = useState(null);
  const [tgOpen, setTgOpen] = useState(false);
  // The result of an OAuth redirect (?connected=key / ?connect_error=Label),
  // read once from the URL on first render (lazy init avoids setState-in-effect).
  const [toast] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected')) return t('connections.connectedToast', 'Connected ✓');
    const err = params.get('connect_error');
    if (err) return t('connections.errorToast', { defaultValue: 'Could not connect {{label}} — please try again.', label: err });
    return '';
  });

  const refresh = useCallback(() => {
    api.get('/api/connect/status').then(setData).catch(() => setData({ catalogue: [], status: {} }));
    api.get('/api/telegram/status').then(setTgStatus).catch(() => setTgStatus({ connected: false }));
  }, []);
  useEffect(refresh, [refresh, activeProfile]);

  // Clean the OAuth params out of the URL after reading them above.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') || params.get('connect_error')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  if (!data) {
    return <div className="text-center" style={{ padding: 40 }}><i className="fa-solid fa-spinner fa-spin fa-2x text-accent"></i></div>;
  }

  // Telegram status comes from its own endpoint; others from /api/connect/status.
  const statusFor = (key) => key === 'telegram'
    ? (tgStatus?.comingSoon
        ? { comingSoon: true, live: true }
        : { connected: !!(tgStatus?.connected && tgStatus?.chat), accountHandle: tgStatus?.botUsername ? `@${tgStatus.botUsername}` : null, live: true, sandbox: false })
    : (data.status[key] || { connected: false });

  const openPlatform = openKey ? data.catalogue.find((c) => c.key === openKey) : null;

  return (
    <div className="connections-panel animate-fade-in">
      <h3>{t('connections.title', 'Platform Connections')}</h3>
      <p className="panel-subtitle">{t('connections.subtitle', 'Connect the platforms Markiv can publish to on your behalf — through each platform’s official API, behind your approval.')}</p>

      {toast && <div className="badge badge-success mb-20" style={{ display: 'block', padding: 10 }} role="status">{toast}</div>}

      <div className="connections-grid">
        {data.catalogue.map((p) => {
          const m = META[p.key] || FALLBACK_META;
          const s = statusFor(p.key);
          const isConnected = !!s.connected;
          const isSandbox = !!s.sandbox && isConnected;
          const comingSoon = !!s.comingSoon;
          return (
            <div key={p.key} className={`connection-card glass-card ${isConnected ? 'connected' : ''}`}>
              <div className="connection-card-head">
                <i className={m.icon} style={{ color: m.color, fontSize: 26 }}></i>
                <div>
                  <h4>{p.label}</h4>
                  <span className={`connection-state ${isConnected ? 'on' : comingSoon ? 'soon' : 'off'}`}>
                    {comingSoon
                      ? t('connections.state.soon', 'Coming soon')
                      : isConnected
                        ? (isSandbox ? t('connections.state.sandbox', 'Connected · sandbox') : t('connections.state.connected', 'Connected'))
                        : (p.live ? t('connections.state.ready', 'Ready to connect') : t('connections.state.sandboxReady', 'Sandbox available'))}
                  </span>
                </div>
              </div>
              {s.accountHandle && <p className="connection-handle text-muted">{s.accountHandle}</p>}
              <button
                className={`btn ${isConnected ? 'btn-secondary' : 'btn-primary'} w-full`}
                disabled={comingSoon}
                onClick={() => (p.key === 'telegram' ? setTgOpen(true) : setOpenKey(p.key))}
                id={`btn_conn_${p.key}`}
              >
                {comingSoon
                  ? t('connections.state.soon', 'Coming soon')
                  : isConnected
                    ? t('connections.manage', 'Manage')
                    : t('connections.connect', 'Connect')}
              </button>
            </div>
          );
        })}
      </div>

      {openPlatform && (
        <ConnectCard
          platform={openPlatform}
          status={data.status[openKey] || { connected: false }}
          meta={META[openKey] || FALLBACK_META}
          onChanged={refresh}
          onClose={() => setOpenKey(null)}
        />
      )}

      {tgOpen && (
        <TelegramConnect
          status={tgStatus}
          onStatusChange={refresh}
          onClose={() => setTgOpen(false)}
        />
      )}
    </div>
  );
}
