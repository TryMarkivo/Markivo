import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import ConnectCard from './ConnectCard';
import TelegramConnect from './TelegramConnect';
import { metaFor } from '../lib/platforms';
import './Connections.css';

/**
 * Dashboard "Connections" tab. Lists EVERY platform the connector framework
 * exposes — connected ones at full strength, the rest dimmed — so the owner can
 * see the whole menu at a glance and tap any card to learn how to connect it.
 * Telegram keeps its dedicated guided modal; everything else uses the generic
 * ConnectCard (OAuth when live, simulated when sandbox).
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
          const m = metaFor(p.key);
          const s = statusFor(p.key);
          const isConnected = !!s.connected;
          const isSandbox = !!s.sandbox && isConnected;
          const comingSoon = !!s.comingSoon;
          // Telegram opens its guided BotFather modal — unless it is gated off,
          // in which case the generic card explains what it will need.
          const openCard = () => ((p.key === 'telegram' && !comingSoon) ? setTgOpen(true) : setOpenKey(p.key));
          return (
            // Unconnected platforms render dimmed but stay fully interactive —
            // tapping one opens its card with the step-by-step instructions.
            <div
              key={p.key}
              className={`connection-card panel ${isConnected ? 'connected' : 'not-connected'}`}
              onClick={openCard}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(); } }}
            >
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
                onClick={(e) => { e.stopPropagation(); openCard(); }}
                id={`btn_conn_${p.key}`}
              >
                {isConnected
                  ? t('connections.manage', 'Manage')
                  : comingSoon
                    ? t('connections.howToCta', 'How to connect')
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
          meta={metaFor(openKey)}
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
