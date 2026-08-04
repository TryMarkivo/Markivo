import { useState, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import AutonomousAgent from './AutonomousAgent';
import MediaStudio from './MediaStudio';
import CompetitorIntel from './CompetitorIntel';
import AIAgentSidebar from './AIAgentSidebar';
import TelegramConnect from './TelegramConnect';
import InstagramConnect from './InstagramConnect';
import InstagramComposer from './InstagramComposer';
import SettingsPane from './SettingsPane';
import BusinessProfilePane from './BusinessProfilePane';
import UpgradePane from './UpgradePane';
import Sparkline from './Sparkline';
import PlatformDetail from './PlatformDetail';
import ThemeToggle from './ThemeToggle';
import ConnectCard from './ConnectCard';
import AutomationCalendar from './AutomationCalendar';
import CreatePost from './CreatePost';
import AIGenerationModal from './AIGenerationModal';
import TemplatesModal from './TemplatesModal';
import { metaFor, composerKeyFor } from '../lib/platforms';
import api from '../lib/api';
import logoUrl from '../assets/markivo-logo.png';
import './Dashboard.css';

// A metric card: number + trend + sparkline, dimmed when it is still sample
// data rather than a real reading, and clickable anywhere to open the
// platform drill-down. Unconnected platforms surface a real "Connect" button
// on hover instead of silently showing a dead chart.
function StatCard({ id, label, platformName, changeText, value, subtitle, color, history, live, connectable, connected, onConnect, onDrill }) {
  const { t } = useTranslation();
  return (
    <div
      className="stat-card glass-card"
      onClick={onDrill}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDrill(); } }}
      id={id}
      aria-label={t('dashboard.stats.drillDown', { defaultValue: 'Show detailed {{platform}} statistics', platform: label })}
    >
      <div className={`stat-card-content ${live ? '' : 'is-demo'}`}>
        <div className="flex-between">
          <span className="stat-label">{label}</span>
          <span className="trend-percentage positive">{changeText}</span>
        </div>
        <div className="stat-number-wrap">
          <h2>{value}</h2>
          <span className="text-muted">{subtitle}</span>
        </div>
        <div className="stat-chart-svg">
          <Sparkline history={history} color={color} label={label} />
        </div>
      </div>
      <span className="stat-chart-cue" aria-hidden="true"><i className="fa-solid fa-up-right-and-down-left-from-center"></i></span>
      {connectable && !connected && (
        <div className="stat-connect-overlay">
          <button
            className="btn btn-primary"
            onClick={(e) => { e.stopPropagation(); onConnect(); }}
            id={`${id}_connect`}
          >
            <i className="fa-solid fa-plug"></i>{' '}
            {t('connections.setupTitle', { defaultValue: 'Connect {{label}}', label: platformName || label })}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ token, activeProfile, onLogout, onProfileUpdate, theme, onToggleTheme, onLanguageChange }) {
  const { t } = useTranslation();
  // Tab state. After an OAuth connect redirect (…/?connected=key or
  // ?connect_error=Label) open the Connections tab so the owner sees the result
  // — computed lazily from the URL to avoid a setState-in-effect cascade.
  const [activeTab, setActiveTab] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return (p.get('connected') || p.get('connect_error')) ? 'settings' : 'analytics';
  }); // 'analytics' | 'calendar' | 'autopilot' | 'markiv' | 'media' | 'competitors' | 'settings'

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
    if (result === 'connected') return t('instagram.noticeConnected', 'Instagram connected ✓');
    const reason = params.get('reason') || 'unknown';
    return t(`instagram.errors.${reason}`, t('instagram.noticeError', 'Could not connect Instagram — please try again.'));
  });
  const [usage, setUsage] = useState(null);
  const [statsOffline, setStatsOffline] = useState(false);
  // Which platform's drill-down is open, opened by clicking a metric's chart.
  const [detailPlatform, setDetailPlatform] = useState(null);
  // The Create Post / Edit Post composer: null when closed, otherwise one of
  // { when } — a fresh post, optionally prefilled from a clicked calendar slot
  // { editEvent } — an existing post opened from the calendar
  // { text, platform, media } — a draft approved from AI Generation, or a
  //   template sent over from Edit Templates
  const [composer, setComposer] = useState(null);
  // Calendar's "AI Generation" and "Edit Templates" popups — the AI Content
  // Engine tab's functionality lives on here, feeding whatever it produces
  // into the Create Post composer above instead of posting on its own.
  const [aiGenerationOpen, setAiGenerationOpen] = useState(false);
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  // Bumped after a successful Create Post schedule to remount (and so refetch)
  // the Calendar tab's AutomationCalendar.
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  // Catalogue + per-platform connection status from the generic connector
  // framework — used to power the stat cards' "Connect" hover button for
  // platforms without a bespoke modal (e.g. Google Business).
  const [connectCatalogue, setConnectCatalogue] = useState(null);
  const [connectModalKey, setConnectModalKey] = useState(null);
  // The Business Profile and Upgrade panes are no longer their own sidebar
  // tabs — they open as a modal from clicking the profile card / usage meter.
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);

  const refreshConnectCatalogue = () => {
    api.get('/api/connect/status')
      .then(setConnectCatalogue)
      .catch(() => setConnectCatalogue({ catalogue: [], status: {} }));
  };
  useEffect(refreshConnectCatalogue, [activeProfile]);

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

  // Side effects for the OAuth return: refresh status on success, strip the
  // query params, and auto-dismiss the notice. (The notice text itself is
  // derived above, so nothing is set synchronously in this effect body.)
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
  }, [activeProfile, activeTab]); // refresh when switching tabs (post-generation)

  useEffect(() => {
    async function fetchStats() {
      const cat = (activeProfile.category || 'business').toLowerCase();
      try {
        const data = await api.get('/api/dashboard/stats');
        setStats(data);
        setStatsOffline(false);
      } catch {
        // Server unreachable — show clearly-flagged offline preset data.
        setStatsOffline(true);
        // Fallback static data customized to category
        setStats({
          metrics: {
            googleViews: { current: 3840, change: 10.2 },
            googleCalls: { current: 112, change: 5.6 },
            instagramFollowers: { current: 1240, change: 12.8 },
            telegramSubscribers: { current: 890, change: 9.4 },
            tiktokFollowers: { current: 0, change: 0 }
          },
          competitors: [
            { name: 'District Cafe & Bakery', platformCount: 3, postsPerWeek: 6, rating: 4.4, followers: 2300 },
            { name: 'Coffee House Central', platformCount: 4, postsPerWeek: 10, rating: 4.6, followers: 4100 },
            { name: 'Local Roasters', platformCount: 2, postsPerWeek: 4, rating: 4.2, followers: 980 }
          ],
          seoKeywords: [
            { keyword_phrase: `best ${cat} in tashkent`, avg_position: 7, volume: 'High' },
            { keyword_phrase: `${cat} workspace`, avg_position: 11, volume: 'Medium' },
            { keyword_phrase: `${cat} near me`, avg_position: 15, volume: 'Very High' }
          ],
          aiPresence: {
            perplexityScore: 72,
            chatgptRank: 'Top 10',
            sourcesCitedCount: 3
          }
        });
      }
      setLoading(false);
    }
    fetchStats();
  }, [activeProfile, token]);

  if (loading || !stats) {
    return (
      <div className="dashboard-loading text-center">
        <i className="fa-solid fa-spinner fa-spin fa-3x text-accent"></i>
        <h3 className="mt-20">{t('dashboard.loading', 'Loading Command Center...')}</h3>
      </div>
    );
  }

  // Helper to render logo symbol
  const logoStyle = activeProfile.logo || { text: activeProfile.businessName, color: '#D4A373', bgColor: '#1A1816', shape: 'circle', icon: '☕' };

  // Label maps for raw API/mock data values (fall back to raw value for unknown codes)
  const volumeLabels = {
    'High': t('dashboard.seo.volume.high', 'High'),
    'Medium': t('dashboard.seo.volume.medium', 'Medium'),
    'Very High': t('dashboard.seo.volume.veryHigh', 'Very High')
  };

  // NOTE: the shell deliberately carries no fade animation. `fadeIn` runs with
  // `animation-fill-mode: forwards`, which leaves `transform: translateY(0)`
  // applied for good — and a transformed ancestor makes `position: fixed`
  // children resolve against IT instead of the viewport, so both side panels
  // would scroll away with the page.
  return (
    <div className="dashboard-shell">
      {/* --- SIDEBAR --- */}
      <aside className={`dashboard-sidebar glass-card ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div className="logo-text">
            <img src={logoUrl} alt="Markivo" className="logo-img" />
            Markivo
          </div>
        </div>

        {/* LOGO BRIEF BLOCK — opens the Business Profile editor */}
        <div
          className="active-profile-card is-clickable"
          onClick={() => setProfileModalOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setProfileModalOpen(true); } }}
          id="btn_open_profile"
          title={t('settings.business', 'Business profile')}
        >
          <div className="sidebar-logo-icon" style={{ backgroundColor: logoStyle.bgColor, borderColor: logoStyle.color, color: logoStyle.color }}>
            {activeProfile.logo?.image ? (
              <img
                src={activeProfile.logo.image}
                alt={activeProfile.businessName}
                style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'contain' }}
              />
            ) : activeProfile.logo?.svg ? (
              <img
                src={'data:image/svg+xml;utf8,' + encodeURIComponent(activeProfile.logo.svg)}
                alt={activeProfile.businessName}
                style={{ width: '100%', height: '100%', borderRadius: 'inherit' }}
              />
            ) : (
              logoStyle.icon || '☕'
            )}
          </div>
          <div className="active-profile-info">
            <h4>{activeProfile.businessName}</h4>
            <small>{activeProfile.category}</small>
          </div>
          <i className="fa-solid fa-chevron-right active-profile-cue" aria-hidden="true"></i>
        </div>

        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
            id="btn_tab_analytics"
          >
            <i className="fa-solid fa-chart-pie"></i> {t('dashboard.nav.metrics', 'Dashboard')}
          </button>
          <button
            className={`nav-item ${activeTab === 'calendar' ? 'active' : ''}`}
            onClick={() => setActiveTab('calendar')}
            id="btn_tab_calendar"
          >
            <i className="fa-solid fa-calendar-days"></i> {t('dashboard.nav.calendar', 'Calendar')}
          </button>
          <button
            className={`nav-item ${activeTab === 'autopilot' ? 'active' : ''}`}
            onClick={() => setActiveTab('autopilot')}
            id="btn_tab_autopilot"
          >
            <i className="fa-solid fa-robot"></i> {t('dashboard.nav.autopilot', 'Autopilot')}
          </button>
          <button
            className={`nav-item ${activeTab === 'markiv' ? 'active' : ''}`}
            onClick={() => setActiveTab('markiv')}
            id="btn_tab_markiv"
          >
            <i className="fa-solid fa-comment-dots"></i> Markiv
          </button>
          <button
            className={`nav-item ${activeTab === 'media' ? 'active' : ''}`}
            onClick={() => setActiveTab('media')}
            id="btn_tab_media"
          >
            <i className="fa-solid fa-clapperboard"></i> {t('dashboard.nav.media', 'Media Studio')}
          </button>
          <button
            className={`nav-item ${activeTab === 'competitors' ? 'active' : ''}`}
            onClick={() => setActiveTab('competitors')}
            id="btn_tab_competitors"
          >
            <i className="fa-solid fa-users-viewfinder"></i> {t('dashboard.nav.competitors', 'Competitor Intel')}
          </button>
          <button
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
            id="btn_tab_settings"
          >
            <i className="fa-solid fa-gear"></i> {t('dashboard.settingsTab', 'Settings')}
          </button>
        </nav>

        <div className="sidebar-footer">
          {usage && (
            <div
              className="usage-meter is-clickable"
              id="usage_meter"
              onClick={() => setUpgradeModalOpen(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setUpgradeModalOpen(true); } }}
              title={t('usage.resetsTitle', { defaultValue: 'Resets {{date}}', date: usage.resetsAt?.slice(0, 10) })}
            >
              <div className="usage-meter-label">
                <span>{t('usage.label', 'AI generations')}</span>
                <span>{t('usage.count', { defaultValue: '{{used}} / {{limit}}', used: usage.used, limit: usage.limit })}</span>
              </div>
              <div className="usage-meter-track">
                <div
                  className={`usage-meter-fill ${usage.used >= usage.limit ? 'full' : ''}`}
                  style={{ width: `${Math.min(100, Math.round((usage.used / usage.limit) * 100))}%` }}
                ></div>
              </div>
              <small className="usage-meter-tier">{t('usage.tierPlan', { defaultValue: '{{tier}} plan', tier: t(`usage.tiers.${usage.tier}`, usage.tier) })}</small>
            </div>
          )}
          <button className="btn btn-danger w-full" onClick={onLogout} id="btn_logout">
            <i className="fa-solid fa-arrow-right-from-bracket"></i> {t('dashboard.exit', 'Exit Dashboard')}
          </button>
        </div>
      </aside>

      {/* --- MAIN MAIN WRAPPER --- */}
      <main className="dashboard-main-content">
        {/* TOP BAR */}
        <header className="main-header glass-card">
          <button className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <i className="fa-solid fa-bars"></i>
          </button>
          <div className="header-location">
            <i className="fa-solid fa-location-dot text-accent"></i> <span>{activeProfile.location || t('dashboard.defaultLocation', 'Tashkent, Uzbekistan')}</span>
          </div>
          <div className="header-badge-wrap">
            <span className="badge badge-success"><i className="fa-solid fa-circle-check"></i> {t('dashboard.systemOperational', 'System Operational')}</span>
            <span className="badge badge-primary">{t('dashboard.versionBadge', 'V1 Live')}</span>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
        </header>

        {/* TABS CONTAINER */}
        <div className="tab-pane-container">
          
          {/* TAB 1: METRICS & SEARCH */}
          {activeTab === 'analytics' && (
            <div className="tab-analytics animate-fade-in">

              {statsOffline && (
                <div className="demo-offline-banner" role="status">
                  <i className="fa-solid fa-triangle-exclamation"></i> {t('common.offlineDemo', 'Demo data — server offline')}
                </div>
              )}

              {/* CONNECTED PLATFORMS */}
              <div className="channels-status-row">
                <h3>{t('dashboard.activeInfrastructure', 'Your Active Infrastructure')}</h3>
                {igNotice && (
                  <div className="badge badge-success mb-10" style={{ display: 'block', padding: 8 }} role="status">{igNotice}</div>
                )}
                <div className="channels-grid">
                  <div className={`channel-pill ${activeProfile.platforms.googleBusiness ? 'connected' : 'inactive'}`}>
                    <i className="fa-brands fa-google"></i> {t('dashboard.channels.google', 'Google Profile')}
                    <span className="dot"></span>
                  </div>
                  <div
                    className={`channel-pill ${igStatus?.connected ? 'connected' : 'inactive'}`}
                    onClick={igStatus?.comingSoon ? undefined : () => setIgModalOpen(true)}
                    style={{ cursor: igStatus?.comingSoon ? 'default' : 'pointer' }}
                    title={
                      igStatus?.comingSoon
                        ? t('instagram.pillTitleSoon', 'Instagram connection is coming soon')
                        : igStatus?.connected
                          ? t('instagram.pillTitleConnected', { defaultValue: 'Connected as @{{username}}', username: igStatus.username || igStatus.accountName || '' })
                          : t('instagram.pillTitleConnect', 'Click to connect Instagram')
                    }
                    id="btn_instagram_pill"
                  >
                    <i className="fa-brands fa-instagram"></i>{' '}
                    {igStatus?.comingSoon
                      ? t('instagram.pillSoon', 'Instagram · soon')
                      : igStatus?.connected
                        ? (igStatus.username
                            ? t('instagram.pillConnected', { defaultValue: 'Instagram · @{{username}}', username: igStatus.username })
                            : t('instagram.pillConnectedGeneric', 'Instagram · connected'))
                        : t('instagram.pillConnect', 'Instagram · connect')}
                    <span className="dot"></span>
                  </div>
                  <div
                    className={`channel-pill ${tgStatus?.connected && tgStatus?.chat ? 'connected' : 'inactive'}`}
                    onClick={tgStatus?.comingSoon ? undefined : () => setTgModalOpen(true)}
                    style={{ cursor: tgStatus?.comingSoon ? 'default' : 'pointer' }}
                    title={
                      tgStatus?.comingSoon
                        ? t('telegram.pillTitleSoon', 'Telegram integration is coming soon')
                        : tgStatus?.connected
                          ? t('telegram.pillTitleBot', { defaultValue: 'Bot @{{username}}', username: tgStatus.botUsername })
                          : t('telegram.pillTitleConnect', 'Click to connect Telegram')
                    }
                    id="btn_telegram_pill"
                  >
                    <i className="fa-brands fa-telegram"></i>{' '}
                    {tgStatus?.comingSoon
                      ? t('telegram.pillSoon', 'Telegram · soon')
                      : tgStatus?.connected && tgStatus?.chat
                        ? t('telegram.pillChat', { defaultValue: 'Telegram · {{chatTitle}}', chatTitle: tgStatus.chat.chatTitle })
                        : tgStatus?.connected
                          ? t('telegram.pillFinishSetup', 'Telegram · finish setup')
                          : t('telegram.pillConnect', 'Telegram · connect')}
                    <span className="dot"></span>
                  </div>
                  <div className={`channel-pill ${activeProfile.platforms.tiktok ? 'connected' : 'inactive'}`}>
                    <i className="fa-brands fa-tiktok"></i> TikTok
                    <span className="dot"></span>
                  </div>
                </div>
              </div>

              {/* CORE METRICS GRID */}
              <div className="grid-3 stats-grid">
                
                {/* GOOGLE MAPS VIEWS */}
                <StatCard
                  id="btn_drill_google"
                  label={t('dashboard.stats.googleViews', 'Google Maps Search Views')}
                  platformName={t('dashboard.channels.google', 'Google Profile')}
                  changeText={t('dashboard.stats.changePositive', { defaultValue: '+{{change}}%', change: stats.metrics.googleViews.change })}
                  value={stats.metrics.googleViews.current.toLocaleString()}
                  subtitle={t('dashboard.stats.past30Days', 'past 30 days')}
                  color="var(--accent-primary)"
                  history={stats.metrics.googleViews.history}
                  live={!!stats.metrics.googleViews.live}
                  connectable
                  connected={!!connectCatalogue?.status?.google_business?.connected}
                  onConnect={() => setConnectModalKey('google_business')}
                  onDrill={() => setDetailPlatform('google')}
                />

                {/* INSTAGRAM FOLLOWERS */}
                <StatCard
                  id="btn_drill_instagram"
                  label={t('dashboard.stats.instagramFollowers', 'Instagram Followers')}
                  platformName="Instagram"
                  changeText={t('dashboard.stats.changePositive', { defaultValue: '+{{change}}%', change: stats.metrics.instagramFollowers.change })}
                  value={stats.metrics.instagramFollowers.current.toLocaleString()}
                  subtitle={`@${activeProfile.businessName.toLowerCase().replace(/ /g, '')}`}
                  color="var(--accent-purple)"
                  history={stats.metrics.instagramFollowers.history}
                  live={!!stats.metrics.instagramFollowers.live}
                  connectable
                  connected={!!igStatus?.connected}
                  onConnect={() => setIgModalOpen(true)}
                  onDrill={() => setDetailPlatform('instagram')}
                />

                {/* TELEGRAM ACTIVE MEMBERS */}
                <StatCard
                  id="btn_drill_telegram"
                  label={t('dashboard.stats.telegramMembers', 'Telegram Channel Members')}
                  platformName="Telegram"
                  changeText={t('dashboard.stats.changePositive', { defaultValue: '+{{change}}%', change: stats.metrics.telegramSubscribers.change })}
                  value={stats.metrics.telegramSubscribers.current.toLocaleString()}
                  subtitle={`t.me/${activeProfile.businessName.toLowerCase().replace(/ /g, '')}`}
                  color="var(--accent-secondary)"
                  history={stats.metrics.telegramSubscribers.history}
                  live={!!stats.metrics.telegramSubscribers.live}
                  connectable
                  connected={!!(tgStatus?.connected && tgStatus?.chat)}
                  onConnect={() => setTgModalOpen(true)}
                  onDrill={() => setDetailPlatform('telegram')}
                />
              </div>

              {/* SEARCH PERFORMANCE ROW */}
              <div className="grid-2 search-analytics-grid mt-30">
                
                {/* SEO LOCAL KEYWORDS */}
                <div className="seo-panel glass-card">
                  <h3>{t('dashboard.seo.title', 'Local SEO Rankings')}</h3>
                  <p className="panel-subtitle">{t('dashboard.seo.subtitle', 'How your business ranks in Tashkent search results')}</p>

                  <div className="keywords-list">
                    <div className="kw-header">
                      <span>{t('dashboard.seo.keywordCol', 'Search Keyword')}</span>
                      <span>{t('dashboard.seo.positionCol', 'Avg. Position')}</span>
                      <span>{t('dashboard.seo.volumeCol', 'Volume')}</span>
                    </div>
                    {stats.seoKeywords.map((kw, idx) => {
                      const position = kw.avg_position ?? kw.position;
                      return (
                        <div key={idx} className="kw-row">
                          <span className="kw-text">{kw.keyword_phrase || kw.keyword}</span>
                          <span className={`kw-pos ${position <= 10 ? 'top-10' : ''}`}>#{position}</span>
                          <span className="kw-volume">{volumeLabels[kw.volume] || kw.volume}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* AI SEARCH PRESENCE INDEX */}
                <div className="ai-search-panel glass-card">
                  <h3>{t('dashboard.aiSearch.title', 'AI Search Visibility')}</h3>
                  <p className="panel-subtitle">{t('dashboard.aiSearch.subtitle', 'How models recommend you in natural chat queries')}</p>

                  <div className="ai-score-ring-wrap">
                    <div className="ai-ring-container">
                      <svg width="80" height="80" viewBox="0 0 36 36" className="circular-chart">
                        <path className="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#222" strokeWidth="2.5" />
                        <path className="circle-fill" strokeDasharray={`${stats.aiPresence.perplexityScore}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" />
                      </svg>
                      <div className="ai-score-inside">
                        <span>{stats.aiPresence.perplexityScore}</span>
                        <small>{t('dashboard.aiSearch.indexLabel', 'index')}</small>
                      </div>
                    </div>
                    <div className="ai-score-info">
                      <h4>{t('dashboard.aiSearch.optimised', 'Highly Search Optimised')}</h4>
                      <p>
                        <Trans
                          i18nKey="dashboard.aiSearch.citedIn"
                          defaults="Cited in <1>{{count}} distinct</1> search models this week."
                          values={{ count: stats.aiPresence.sourcesCitedCount }}
                          components={{ 1: <strong /> }}
                        />
                      </p>
                    </div>
                  </div>

                  <div className="ai-mentions-breakdown border-top-onboard pt-20">
                    <div className="mention-item">
                      <span><i className="fa-solid fa-message text-success"></i> {t('dashboard.aiSearch.chatgptRank', 'ChatGPT recommendation rank')}</span>
                      <strong className="text-success">{stats.aiPresence.chatgptRank === 'Top 10' ? t('dashboard.aiSearch.rankTop10', 'Top 10') : stats.aiPresence.chatgptRank}</strong>
                    </div>
                    <div className="mention-item mt-10">
                      <span><i className="fa-solid fa-lightbulb text-accent"></i> {t('dashboard.aiSearch.perplexityCitations', 'Perplexity Citations')}</span>
                      <strong>{t('dashboard.aiSearch.active', 'Active')}</strong>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* TAB: CALENDAR — scheduling home, with the Create Post entry point */}
          {activeTab === 'calendar' && (
            <AutomationCalendar
              key={calendarRefreshKey}
              activeProfile={activeProfile}
              onCreatePost={(when) => setComposer({ when: when || null })}
              onEditEvent={(editEvent) => setComposer({ editEvent })}
              onOpenAiGeneration={() => setAiGenerationOpen(true)}
              onOpenTemplates={() => setTemplatesModalOpen(true)}
            />
          )}

          {activeTab === 'autopilot' && (
            <AutonomousAgent activeProfile={activeProfile} />
          )}

          {/* TAB: MARKIV — the AI marketing agent, now its own tab rather than
              a persistent floating panel. */}
          {activeTab === 'markiv' && (
            <AIAgentSidebar activeProfile={activeProfile} telegramStatus={tgStatus} asTab />
          )}

          {/* TAB 3: MEDIA STUDIO */}
          {activeTab === 'media' && (
            <MediaStudio activeProfile={activeProfile} />
          )}

          {/* TAB 4: COMPETITOR INTEL */}
          {activeTab === 'competitors' && (
            <CompetitorIntel token={token} stats={stats} activeProfile={activeProfile} />
          )}

          {/* TAB 5: SETTINGS (appearance + connections) */}
          {activeTab === 'settings' && (
            <SettingsPane
              activeProfile={activeProfile}
              theme={theme}
              onToggleTheme={onToggleTheme}
              onLanguageChange={onLanguageChange}
            />
          )}
        </div>
      </main>

      {/* --- TELEGRAM CONNECT MODAL --- */}
      {tgModalOpen && (
        <TelegramConnect
          status={tgStatus}
          onStatusChange={refreshTelegramStatus}
          onClose={() => setTgModalOpen(false)}
        />
      )}

      {/* --- INSTAGRAM CONNECT MODAL --- */}
      {igModalOpen && (
        <InstagramConnect
          status={igStatus}
          onStatusChange={refreshInstagramStatus}
          onClose={() => setIgModalOpen(false)}
          onCompose={() => { setIgModalOpen(false); setIgComposerOpen(true); }}
        />
      )}

      {/* --- INSTAGRAM COMPOSER MODAL --- */}
      {igComposerOpen && (
        <InstagramComposer
          status={igStatus}
          onPosted={refreshInstagramStatus}
          onClose={() => setIgComposerOpen(false)}
        />
      )}

      {/* --- GENERIC CONNECT MODAL (e.g. Google Business, from a stat card's
           "Connect" hover button) --- */}
      {connectModalKey && connectCatalogue?.catalogue?.find((c) => c.key === connectModalKey) && (
        <ConnectCard
          platform={connectCatalogue.catalogue.find((c) => c.key === connectModalKey)}
          status={connectCatalogue.status[connectModalKey] || { connected: false }}
          meta={metaFor(connectModalKey)}
          onChanged={refreshConnectCatalogue}
          onClose={() => setConnectModalKey(null)}
        />
      )}

      {/* --- PLATFORM DRILL-DOWN --- */}
      {detailPlatform && (
        <PlatformDetail
          key={detailPlatform}
          platform={detailPlatform}
          onClose={() => setDetailPlatform(null)}
          onGoToConnections={() => setActiveTab('settings')}
        />
      )}

      {/* --- CREATE POST / EDIT POST COMPOSER --- */}
      {composer && (
        <CreatePost
          activeProfile={activeProfile}
          initialWhen={composer.when}
          initialText={composer.text}
          initialPlatform={composer.platform}
          initialMedia={composer.media}
          editEvent={composer.editEvent}
          onClose={() => setComposer(null)}
          onScheduled={() => setCalendarRefreshKey((k) => k + 1)}
          onGoToConnections={() => { setComposer(null); setActiveTab('settings'); }}
        />
      )}

      {/* --- AI GENERATION (Calendar) — generates text only; approving hands it
           to the Create Post composer above. --- */}
      {aiGenerationOpen && (
        <AIGenerationModal
          activeProfile={activeProfile}
          onClose={() => setAiGenerationOpen(false)}
          onApprove={(text, platform) => { setAiGenerationOpen(false); setComposer({ text, platform: composerKeyFor(platform) }); }}
        />
      )}

      {/* --- EDIT TEMPLATES (Calendar) — TemplateStudio itself, unchanged;
           using a template hands it to Create Post the same way. --- */}
      {templatesModalOpen && (
        <TemplatesModal
          activeProfile={activeProfile}
          onClose={() => setTemplatesModalOpen(false)}
          onUseTemplate={(text, media, platform) => { setTemplatesModalOpen(false); setComposer({ text, media, platform: composerKeyFor(platform) }); }}
        />
      )}

      {/* --- BUSINESS PROFILE MODAL (opened from the sidebar's profile card) --- */}
      {profileModalOpen && (
        <div className="auth-overlay animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) setProfileModalOpen(false); }}>
          <div className="glass-card glass-card-glow text-left side-pane-modal" role="dialog" aria-modal="true" aria-label={t('settings.business', 'Business profile')}>
            <button className="btn-close side-pane-modal-close" onClick={() => setProfileModalOpen(false)} aria-label={t('common.close', 'Close')}>
              <i className="fa-solid fa-xmark"></i>
            </button>
            <BusinessProfilePane activeProfile={activeProfile} onProfileUpdate={onProfileUpdate} />
          </div>
        </div>
      )}

      {/* --- UPGRADE MODAL (opened from the sidebar's usage meter) --- */}
      {upgradeModalOpen && (
        <div className="auth-overlay animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) setUpgradeModalOpen(false); }}>
          <div className="glass-card glass-card-glow text-left side-pane-modal" role="dialog" aria-modal="true" aria-label={t('settings.plan.title', 'Plan & billing')}>
            <button className="btn-close side-pane-modal-close" onClick={() => setUpgradeModalOpen(false)} aria-label={t('common.close', 'Close')}>
              <i className="fa-solid fa-xmark"></i>
            </button>
            <UpgradePane onBillingChanged={() => api.get('/api/usage').then(setUsage).catch(() => {})} />
          </div>
        </div>
      )}
    </div>
  );
}
