import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ContentEngine from './ContentEngine';
import AutonomousAgent from './AutonomousAgent';
import MediaStudio from './MediaStudio';
import CompetitorIntel from './CompetitorIntel';
import AIAgentSidebar from './AIAgentSidebar';
import TelegramConnect from './TelegramConnect';
import InstagramConnect from './InstagramConnect';
import ConnectionsPanel from './ConnectionsPanel';
import InstagramComposer from './InstagramComposer';
import SettingsPane from './SettingsPane';
import Sparkline from './Sparkline';
import ThemeToggle from './ThemeToggle';
import api from '../lib/api';
import logoUrl from '../assets/markivo-logo.png';
import './Dashboard.css';

const NAV = [
  { key: 'analytics', icon: 'fa-chart-simple', i18n: 'dashboard.nav.metrics', fallback: 'Dashboard' },
  { key: 'content', icon: 'fa-pen-nib', i18n: 'dashboard.nav.content', fallback: 'AI Content Engine' },
  { key: 'autopilot', icon: 'fa-robot', i18n: 'dashboard.nav.autopilot', fallback: 'Autopilot' },
  { key: 'media', icon: 'fa-clapperboard', i18n: 'dashboard.nav.media', fallback: 'Media Studio' },
  { key: 'competitors', icon: 'fa-users-viewfinder', i18n: 'dashboard.nav.competitors', fallback: 'Competitor Intel' },
  { key: 'connections', icon: 'fa-plug', i18n: 'dashboard.nav.connections', fallback: 'Connections' },
  { key: 'settings', icon: 'fa-sliders', i18n: 'dashboard.settingsTab', fallback: 'Settings' },
];

const hhmm = (iso, lang) =>
  new Date(iso).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hour12: false });

export default function Dashboard({ token, activeProfile, onLogout, onProfileUpdate, theme, onToggleTheme, onLanguageChange }) {
  const { t, i18n } = useTranslation();
  // Tab state. After an OAuth connect redirect (…/?connected=key or
  // ?connect_error=Label) open the Connections tab so the owner sees the result
  // — computed lazily from the URL to avoid a setState-in-effect cascade.
  const [activeTab, setActiveTab] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return (p.get('connected') || p.get('connect_error')) ? 'connections' : 'analytics';
  });

  const [stats, setStats] = useState(null);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [railOpen, setRailOpen] = useState(false); // mobile drawer only
  // Markiv AI lives here rather than inside the panel: collapsing it has to give
  // the main column back the space it was reserving. It starts CLOSED on narrow
  // screens — open, the band covers the whole viewport, which would bury the
  // queue behind a chat panel nobody asked for.
  const [agentOpen, setAgentOpen] = useState(() => window.innerWidth > 1280);
  const [tgStatus, setTgStatus] = useState(null);
  const [tgModalOpen, setTgModalOpen] = useState(false);
  const [igStatus, setIgStatus] = useState(null);
  const [igModalOpen, setIgModalOpen] = useState(false);
  const [igComposerOpen, setIgComposerOpen] = useState(false);
  // Derive the OAuth round-trip notice once, from the URL the callback set us to
  // (?instagram=connected|error&reason=…). A lazy initializer reads this external
  // state during the first render; the effect below only handles side effects.
  const [igNotice, setIgNotice] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('instagram');
    if (!result) return '';
    if (result === 'connected') return t('instagram.noticeConnected', 'Instagram connected');
    const reason = params.get('reason') || 'unknown';
    return t(`instagram.errors.${reason}`, t('instagram.noticeError', 'Could not connect Instagram — please try again.'));
  });
  const [usage, setUsage] = useState(null);
  const [statsOffline, setStatsOffline] = useState(false);

  const refreshTelegramStatus = () => {
    api.get('/api/telegram/status')
      .then(setTgStatus)
      .catch(() => setTgStatus({ connected: false }));
  };
  useEffect(refreshTelegramStatus, [activeProfile]);

  const refreshInstagramStatus = () => {
    api.get('/api/instagram/status')
      .then(setIgStatus)
      .catch(() => setIgStatus({ connected: false }));
  };
  useEffect(refreshInstagramStatus, [activeProfile]);

  const refreshQueue = () => {
    api.get('/api/content/calendar').then((rows) => setQueue(rows || [])).catch(() => setQueue([]));
  };
  useEffect(refreshQueue, [activeProfile, activeTab]);

  // Side effects for the OAuth return: refresh status on success, strip the
  // query params, and auto-dismiss the notice.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('instagram');
    if (!result) return;
    if (result === 'connected') refreshInstagramStatus();
    params.delete('instagram');
    params.delete('reason');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    const timer = setTimeout(() => setIgNotice(''), 6000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    api.get('/api/usage').then(setUsage).catch(() => setUsage(null));
  }, [activeProfile, activeTab]);

  useEffect(() => {
    async function fetchStats() {
      const cat = (activeProfile.category || 'business').toLowerCase();
      try {
        const data = await api.get('/api/dashboard/stats');
        setStats(data);
        setStatsOffline(false);
      } catch {
        // Server unreachable — show clearly-flagged offline preset data. Every
        // metric is marked simulated so the whole board frays, not just some.
        setStatsOffline(true);
        setStats({
          metrics: {
            googleViews: { current: 3840, change: 10.2, simulated: true },
            googleCalls: { current: 112, change: 5.6, simulated: true },
            instagramFollowers: { current: 1240, change: 12.8, simulated: true },
            telegramSubscribers: { current: 890, change: 9.4, simulated: true },
            tiktokFollowers: { current: 0, change: 0, simulated: true },
          },
          competitors: [
            { name: 'District Cafe & Bakery', platformCount: 3, postsPerWeek: 6, rating: 4.4, followers: 2300 },
            { name: 'Coffee House Central', platformCount: 4, postsPerWeek: 10, rating: 4.6, followers: 4100 },
            { name: 'Local Roasters', platformCount: 2, postsPerWeek: 4, rating: 4.2, followers: 980 },
          ],
          seoKeywords: [
            { keyword_phrase: `best ${cat} in tashkent`, avg_position: 7, volume: 'High' },
            { keyword_phrase: `${cat} workspace`, avg_position: 11, volume: 'Medium' },
            { keyword_phrase: `${cat} near me`, avg_position: 15, volume: 'Very High' },
          ],
          aiPresence: { perplexityScore: 72, chatgptRank: 'Top 10', sourcesCitedCount: 3 },
          simulated: { seoKeywords: true, competitors: true, aiPresence: true },
        });
      }
      setLoading(false);
    }
    fetchStats();
  }, [activeProfile, token]);

  // The channel warp band. Each stripe is a dyed band whose state is its
  // colour, and whose edge is hard when the connection publishes for real.
  const channels = useMemo(() => [
    {
      key: 'instagram',
      label: 'Instagram',
      icon: 'fa-brands fa-instagram',
      state: igStatus?.comingSoon ? 'off' : igStatus?.connected ? 'live' : 'off',
      detail: igStatus?.comingSoon
        ? t('instagram.pillSoon', 'Coming soon')
        : igStatus?.connected
          ? (igStatus.username ? `@${igStatus.username}` : t('instagram.pillConnectedGeneric', 'Connected'))
          : t('dashboard.warp.notConnected', 'Not connected'),
      onClick: igStatus?.comingSoon ? null : () => setIgModalOpen(true),
    },
    {
      key: 'telegram',
      label: 'Telegram',
      icon: 'fa-brands fa-telegram',
      state: tgStatus?.comingSoon ? 'off' : (tgStatus?.connected && tgStatus?.chat) ? 'live' : 'off',
      detail: tgStatus?.comingSoon
        ? t('telegram.pillSoon', 'Coming soon')
        : tgStatus?.connected && tgStatus?.chat
          ? tgStatus.chat.chatTitle
          : tgStatus?.connected
            ? t('telegram.pillFinishSetup', 'Finish setup')
            : t('dashboard.warp.notConnected', 'Not connected'),
      onClick: tgStatus?.comingSoon ? null : () => setTgModalOpen(true),
    },
    {
      key: 'google',
      label: t('dashboard.channels.google', 'Google Profile'),
      icon: 'fa-brands fa-google',
      // Connected in the profile, but publishing is simulated until the
      // integration lands — so it frays rather than claiming to be live.
      state: activeProfile.platforms?.googleBusiness ? 'sim' : 'off',
      detail: activeProfile.platforms?.googleBusiness
        ? t('dashboard.warp.simulated', 'Simulated publishing')
        : t('dashboard.warp.notConnected', 'Not connected'),
      onClick: () => setActiveTab('connections'),
    },
    {
      key: 'tiktok',
      label: 'TikTok',
      icon: 'fa-brands fa-tiktok',
      state: activeProfile.platforms?.tiktok ? 'sim' : 'off',
      detail: activeProfile.platforms?.tiktok
        ? t('dashboard.warp.simulated', 'Simulated publishing')
        : t('dashboard.warp.notConnected', 'Not connected'),
      onClick: () => setActiveTab('connections'),
    },
  ], [igStatus, tgStatus, activeProfile, t]);

  // Today first, then the next few days. Past posts stay in the list only for
  // today, because "what already went out today" is the thing being checked.
  const upcoming = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return [...queue]
      .filter((r) => new Date(r.scheduled_time) >= startOfToday)
      .sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time))
      .slice(0, 8);
  }, [queue]);

  if (loading || !stats) {
    return (
      <div className="app-loading">
        <i className="fa-solid fa-spinner fa-spin"></i>
        <span>{t('dashboard.loading', 'Loading your workroom…')}</span>
      </div>
    );
  }

  const logoStyle = activeProfile.logo || { text: activeProfile.businessName, color: '#d81f3c', bgColor: '#1c1c3a', shape: 'square', icon: '·' };

  const volumeLabels = {
    'High': t('dashboard.seo.volume.high', 'High'),
    'Medium': t('dashboard.seo.volume.medium', 'Medium'),
    'Very High': t('dashboard.seo.volume.veryHigh', 'Very High'),
  };

  const simFlags = stats.simulated || {};

  const metricPanels = [
    {
      key: 'telegramSubscribers',
      label: t('dashboard.stats.telegramMembers', 'Telegram members'),
      sub: `t.me/${activeProfile.businessName.toLowerCase().replace(/ /g, '')}`,
      color: 'var(--jade)',
    },
    {
      key: 'instagramFollowers',
      label: t('dashboard.stats.instagramFollowers', 'Instagram followers'),
      sub: `@${activeProfile.businessName.toLowerCase().replace(/ /g, '')}`,
      color: 'var(--madder)',
    },
    {
      key: 'googleViews',
      label: t('dashboard.stats.googleViews', 'Google Maps views'),
      sub: t('dashboard.stats.past30Days', 'past 30 days'),
      color: 'var(--saffron)',
    },
  ];

  return (
    <div className="shell">
      {/* --- SELVEDGE: the bound edge of the cloth --- */}
      <aside className={`selvedge ${railOpen ? 'open' : ''}`} id="selvedge">
        <div className="selvedge-brand">
          <img src={logoUrl} alt="Markivo" className="selvedge-logo" />
          <span>Markivo</span>
        </div>

        <button className="selvedge-profile" onClick={() => setActiveTab('settings')} id="btn_active_profile">
          <span className="selvedge-mark" style={{ background: logoStyle.bgColor, color: logoStyle.color }}>
            {activeProfile.logo?.image ? (
              <img src={activeProfile.logo.image} alt="" />
            ) : activeProfile.logo?.svg ? (
              <img src={'data:image/svg+xml;utf8,' + encodeURIComponent(activeProfile.logo.svg)} alt="" />
            ) : (
              (activeProfile.businessName || '?').charAt(0).toUpperCase()
            )}
          </span>
          <span className="selvedge-profile-text">
            <strong>{activeProfile.businessName}</strong>
            <small>{activeProfile.category}</small>
          </span>
        </button>

        <nav className="selvedge-nav" aria-label={t('dashboard.nav.aria', 'Sections')}>
          {NAV.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${activeTab === item.key ? 'active' : ''}`}
              onClick={() => { setActiveTab(item.key); setRailOpen(false); }}
              id={`btn_tab_${item.key}`}
              aria-current={activeTab === item.key ? 'page' : undefined}
            >
              <i className={`fa-solid ${item.icon}`} aria-hidden="true"></i>
              <span>{t(item.i18n, item.fallback)}</span>
            </button>
          ))}
        </nav>

        <div className="selvedge-foot">
          {usage && (
            <div className="usage" id="usage_meter">
              <div className="usage-top">
                <span className="label">{t('usage.label', 'AI generations')}</span>
                <span className="num small">{usage.used}/{usage.limit}</span>
              </div>
              <div
                className="usage-track"
                role="progressbar"
                aria-valuenow={usage.used}
                aria-valuemin={0}
                aria-valuemax={usage.limit}
              >
                <div
                  className={`usage-fill ${usage.used >= usage.limit ? 'full' : ''}`}
                  style={{ transform: `scaleX(${Math.min(1, usage.used / Math.max(1, usage.limit))})` }}
                ></div>
              </div>
              <small className="usage-tier">
                {t('usage.tierPlan', { defaultValue: '{{tier}} plan', tier: t(`usage.tiers.${usage.tier}`, usage.tier) })}
              </small>
            </div>
          )}
          <button className="btn btn-ghost btn-block" onClick={onLogout} id="btn_logout">
            <i className="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i>
            {t('dashboard.exit', 'Sign out')}
          </button>
        </div>
      </aside>

      {railOpen && <button className="selvedge-scrim" onClick={() => setRailOpen(false)} aria-label={t('common.close', 'Close')} />}

      {/* --- FIELD --- */}
      <main className={`field ${agentOpen ? '' : 'agent-collapsed'}`}>
        <header className="field-head">
          <button className="rail-toggle" onClick={() => setRailOpen(true)} aria-label={t('dashboard.nav.aria', 'Sections')}>
            <i className="fa-solid fa-bars"></i>
          </button>
          <h1 className="field-title">
            {t(NAV.find((n) => n.key === activeTab)?.i18n, NAV.find((n) => n.key === activeTab)?.fallback)}
          </h1>
          <div className="field-head-right">
            <span className="field-place">
              <i className="fa-solid fa-location-dot" aria-hidden="true"></i>
              {activeProfile.location || t('dashboard.defaultLocation', 'Tashkent, Uzbekistan')}
            </span>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
        </header>

        <div className="field-body">
          {/* ===== DASHBOARD ===== */}
          {activeTab === 'analytics' && (
            <div className="stack animate-fade-in">
              {statsOffline && (
                <div className="demo-offline-banner" role="status">
                  <i className="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                  {t('common.offlineDemo', 'Demo data — server offline')}
                </div>
              )}
              {igNotice && (
                <div className="demo-offline-banner" role="status" style={{ borderLeftColor: 'var(--jade)', background: 'var(--jade-field)', color: 'var(--jade)' }}>
                  <i className="fa-solid fa-circle-check" aria-hidden="true"></i>{igNotice}
                </div>
              )}

              {/* --- WARP BAND: channels, then the queue, seamed together.
                  The band is the first thing on the page — no title row above
                  it — and Compose is its rightmost cell. --- */}
              <section className="panel opening" aria-labelledby="h_channels">
                <h2 id="h_channels" className="visually-hidden">
                  {t('dashboard.activeInfrastructure', 'Channels')}
                </h2>

                <div className="warp warp-flush">
                  {channels.map((c) => (
                    <button
                      key={c.key}
                      className={`warp-stripe is-${c.state} ${c.state === 'sim' ? 'frayed' : ''}`}
                      // Every stripe is a route, including the disconnected
                      // ones: on a new account all four are off, and a band of
                      // dead buttons leaves the operator with nowhere to go.
                      onClick={c.onClick || (() => setActiveTab('connections'))}
                      id={`btn_warp_${c.key}`}
                    >
                      <span className="warp-name">
                        <i className={c.icon} aria-hidden="true"></i>{c.label}
                      </span>
                      {/* The detail line already names the state in words, so
                          the stripe does not repeat it as a second badge. */}
                      <span className="warp-foot">
                        <span className={`warp-state ${c.state === 'sim' ? 'is-warn' : ''}`}>{c.detail}</span>
                      </span>
                    </button>
                  ))}

                  <div className="warp-action">
                    <button className="btn btn-primary btn-block" onClick={() => setActiveTab('content')} id="btn_compose">
                      <i className="fa-solid fa-pen-nib" aria-hidden="true"></i>
                      {t('dashboard.compose', 'Compose')}
                    </button>
                  </div>
                </div>

                <div className="queue">
                  <div className="queue-head">
                    <h3 className="label">{t('dashboard.queue.title', 'Queue')}</h3>
                    <button className="btn btn-ghost btn-sm" onClick={() => setActiveTab('autopilot')} id="btn_open_calendar">
                      {t('dashboard.queue.openCalendar', 'Open calendar')}
                      <i className="fa-solid fa-arrow-right" aria-hidden="true"></i>
                    </button>
                  </div>

                  {upcoming.length === 0 ? (
                    <div className="empty">
                      <h4>{t('dashboard.queue.emptyTitle', 'Nothing queued')}</h4>
                      <p>{t('dashboard.queue.emptyBody', 'Write a post in the Content Engine and schedule it — it will appear here with its time and channel.')}</p>
                      <button className="btn btn-primary btn-sm" onClick={() => setActiveTab('content')}>
                        {t('dashboard.queue.emptyCta', 'Write the first post')}
                      </button>
                    </div>
                  ) : (
                    <ul className="queue-rows">
                      {upcoming.map((row) => {
                        const state = row.status === 'posted' ? 'live' : row.status === 'failed' ? 'failed' : 'queued';
                        return (
                          <li key={row.id} className={`queue-row is-${state}`}>
                            <time className="num queue-time" dateTime={row.scheduled_time}>
                              {hhmm(row.scheduled_time, i18n.language)}
                            </time>
                            {/* Day and channel travel together so they can drop
                                onto a second line on narrow screens instead of
                                being hidden — they are the row's whole point. */}
                            <span className="queue-meta">
                              <span className="queue-day label">
                                {new Date(row.scheduled_time).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })}
                              </span>
                              <span className="queue-platform">{row.platform}</span>
                            </span>
                            <p className="queue-text">{row.post_text}</p>
                            <span className={`stamp stamp-${state}`}>
                              {t(`dashboard.queue.status.${state}`, state)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>

              {/* --- MEASUREMENTS: below the queue, because the queue is the
                  job. One panel divided by seams, not three floating cards. --- */}
              <section className="panel" aria-labelledby="h_metrics">
                <div className="panel-head">
                  <h2 id="h_metrics">{t('dashboard.measurements', 'Measurements')}</h2>
                  {/* One legend for the whole strip, so the frayed hem is
                      explained once instead of five times in five wordings. */}
                  <span className="truth-legend">
                    <span className="truth-key is-hard">{t('truth.measured', 'Measured')}</span>
                    <span className="truth-key is-frayed">{t('truth.simulated', 'Simulated')}</span>
                  </span>
                </div>
                <div className="metric-strip">
                  {metricPanels.map((m) => {
                    const metric = stats.metrics[m.key];
                    if (!metric) return null;
                    const sim = !!metric.simulated;
                    return (
                      <article
                        key={m.key}
                        className={`metric ${sim ? 'frayed' : ''}`}
                        style={{ '--fray': 'var(--saffron)' }}
                      >
                        <div className="metric-top">
                          <span className="label">{m.label}</span>
                          <span className={sim ? 'frayed-note' : 'stamp stamp-live'}>
                            {sim ? t('truth.simulated', 'Simulated') : t('truth.measured', 'Measured')}
                          </span>
                        </div>
                        <p className="metric-value num">{metric.current.toLocaleString()}</p>
                        <p className="metric-sub">{m.sub}</p>
                        {/* A simulated number has no history worth plotting —
                            it is the same constant every day, so claiming to be
                            "collecting data" on it would be a second untruth. */}
                        {!sim && (
                          <div className="metric-chart">
                            <Sparkline history={metric.history} color={m.color} label={m.label} />
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>

              {/* --- SEARCH --- */}
              <div className="grid-2">
                <section className={`panel ${simFlags.seoKeywords ? 'frayed' : ''}`} style={{ '--fray': 'var(--saffron)' }} aria-labelledby="h_seo">
                  <div className="panel-head">
                    <h2 id="h_seo">{t('dashboard.seo.title', 'Local search')}</h2>
                    {/* One word per truth-state, driven by the flag. A number
                        the backend marks simulated says SIMULATED wherever it
                        sits; ESTIMATE is reserved for a real capture that has
                        gone stale, which this demo profile is not. */}
                    {simFlags.seoKeywords && (
                      <span className="frayed-note">{t('truth.simulated', 'Simulated')}</span>
                    )}
                  </div>
                  <div className="rows">
                    <div className="row-head kw-grid">
                      <span>{t('dashboard.seo.keywordCol', 'Keyword')}</span>
                      <span>{t('dashboard.seo.positionCol', 'Position')}</span>
                      <span>{t('dashboard.seo.volumeCol', 'Volume')}</span>
                    </div>
                    {stats.seoKeywords.map((kw, idx) => {
                      const position = kw.avg_position ?? kw.position;
                      return (
                        <div key={idx} className="row kw-grid">
                          <span>{kw.keyword_phrase || kw.keyword}</span>
                          <span className={`num ${position <= 10 ? 'text-live' : 'text-secondary'}`}>#{position}</span>
                          <span className="small text-secondary">{volumeLabels[kw.volume] || kw.volume}</span>
                        </div>
                      );
                    })}
                  </div>
                  {simFlags.seoKeywords && (
                    <p className="panel-foot">
                      {t('dashboard.seo.estimateNote', 'Captured when this profile was created and not re-measured since. Connect Google Business for live ranks.')}
                    </p>
                  )}
                </section>

                <section className={`panel ${simFlags.aiPresence ? 'frayed' : ''}`} style={{ '--fray': 'var(--saffron)' }} aria-labelledby="h_ai">
                  <div className="panel-head">
                    <h2 id="h_ai">{t('dashboard.aiSearch.title', 'AI search visibility')}</h2>
                    {simFlags.aiPresence && (
                      <span className="frayed-note">{t('truth.simulated', 'Simulated')}</span>
                    )}
                  </div>
                  <div className="panel-body">
                    <div className="ai-score">
                      <span className="ai-score-num num">{stats.aiPresence.perplexityScore}</span>
                      <div>
                        <h4>{t('dashboard.aiSearch.optimised', 'Index score')}</h4>
                        <p className="small text-secondary">
                          {t('dashboard.aiSearch.scale', 'Out of 100, across chat-model recommendations')}
                        </p>
                      </div>
                    </div>
                    <div className="ai-bar" role="img" aria-label={`${stats.aiPresence.perplexityScore} / 100`}>
                      <span style={{ width: `${stats.aiPresence.perplexityScore}%` }}></span>
                    </div>
                    <dl className="ai-facts">
                      <div>
                        <dt className="label">{t('dashboard.aiSearch.chatgptRank', 'Chat rank')}</dt>
                        <dd>{stats.aiPresence.chatgptRank}</dd>
                      </div>
                      <div>
                        <dt className="label">{t('dashboard.aiSearch.perplexityCitations', 'Citations')}</dt>
                        <dd className="num">{stats.aiPresence.sourcesCitedCount}</dd>
                      </div>
                    </dl>
                  </div>
                  {simFlags.aiPresence && (
                    <p className="panel-foot">
                      {t('dashboard.aiSearch.placeholderNote', 'This score is a fixed placeholder, identical for every business. It is not measured yet.')}
                    </p>
                  )}
                </section>
              </div>
            </div>
          )}

          {activeTab === 'content' && (
            <ContentEngine
              token={token}
              activeProfile={activeProfile}
              onGoToConnections={() => setActiveTab('connections')}
            />
          )}

          {activeTab === 'autopilot' && <AutonomousAgent activeProfile={activeProfile} />}

          {activeTab === 'media' && <MediaStudio activeProfile={activeProfile} />}

          {activeTab === 'competitors' && (
            <CompetitorIntel token={token} stats={stats} activeProfile={activeProfile} />
          )}

          {activeTab === 'connections' && <ConnectionsPanel activeProfile={activeProfile} />}

          {activeTab === 'settings' && (
            <SettingsPane
              activeProfile={activeProfile}
              onProfileUpdate={onProfileUpdate}
              theme={theme}
              onToggleTheme={onToggleTheme}
              onLanguageChange={onLanguageChange}
              onBillingChanged={() => api.get('/api/usage').then(setUsage).catch(() => {})}
            />
          )}
        </div>
      </main>

      {tgModalOpen && (
        <TelegramConnect
          status={tgStatus}
          onStatusChange={refreshTelegramStatus}
          onClose={() => setTgModalOpen(false)}
        />
      )}

      {igModalOpen && (
        <InstagramConnect
          status={igStatus}
          onStatusChange={refreshInstagramStatus}
          onClose={() => setIgModalOpen(false)}
          onCompose={() => { setIgModalOpen(false); setIgComposerOpen(true); }}
        />
      )}

      {igComposerOpen && (
        <InstagramComposer
          status={igStatus}
          onPosted={refreshInstagramStatus}
          onClose={() => setIgComposerOpen(false)}
        />
      )}

      <AIAgentSidebar
        token={token}
        activeProfile={activeProfile}
        telegramStatus={tgStatus}
        isOpen={agentOpen}
        onToggle={() => setAgentOpen((open) => !open)}
      />
    </div>
  );
}
