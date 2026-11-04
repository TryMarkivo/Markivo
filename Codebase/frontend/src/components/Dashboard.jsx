import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import AutonomousAgent from './AutonomousAgent';
import MediaStudio from './MediaStudio';
import CompetitorIntel from './CompetitorIntel';
// DISABLED: Markiv temporarily off — see 2026-08-15
// import AIAgentSidebar from './AIAgentSidebar';
import TelegramConnect from './TelegramConnect';
import InstagramConnect from './InstagramConnect';
import SettingsPane from './SettingsPane';
import BusinessProfilePane from './BusinessProfilePane';
import UpgradePane from './UpgradePane';
import Sparkline from './Sparkline';
import PlatformDetail from './PlatformDetail';
import Icon from './ui/Icon';
import PostsCalendar from './PostsCalendar';
import PostPanel from './PostPanel';
import { categoryLabel } from '../lib/businessVocab';
import api from '../lib/api';
import { DEMO } from '../lib/demo';
import logoUrl from '../assets/markivo-logo.png';
import './Dashboard.css';
import InfoTip from './ui/InfoTip';

// A metric card. Connected: the real number, its trend and a sparkline, and a
// click opens the platform drill-down. Not connected: no number at all (never
// an invented one), just what connecting would show and the button to do it.
function StatCard({ id, label, platformName, change, value, subtitle, color, history, live, onConnect, onDrill }) {
  const { t } = useTranslation();
  if (!live) {
    return (
      <div className="stat-card glass-card is-empty" id={id}>
        <span className="stat-label">{label}</span>
        <p className="stat-empty-text">
          {t('dashboard.stats.connectToSee', { defaultValue: 'Connect {{platform}} to see this number here.', platform: platformName })}
        </p>
        <button className="btn btn-primary btn-sm" onClick={onConnect} id={`${id}_connect`}>
          {t('connections.setupTitle', { defaultValue: 'Connect {{label}}', label: platformName })}
        </button>
      </div>
    );
  }
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
      <div className="stat-card-content">
        <div className="flex-between">
          <span className="stat-label">{label}</span>
          {Number.isFinite(change) && change !== 0 && (
            <span className={`trend-percentage ${change > 0 ? 'positive' : 'negative'}`}>
              {change > 0 ? '+' : ''}{change}%
            </span>
          )}
        </div>
        <div className="stat-number-wrap">
          <h2>{value}</h2>
          {subtitle && <span className="text-muted">{subtitle}</span>}
        </div>
        <div className="stat-chart-svg">
          <Sparkline history={history} color={color} label={label} />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({ token, activeProfile, onLogout, onProfileUpdate, theme, onToggleTheme, onLanguageChange }) {
  const { t } = useTranslation();
  // Tab state. After an OAuth connect redirect (…/?connected=key or
  // ?connect_error=Label) open the Connections tab so the owner sees the result
  // — computed lazily from the URL to avoid a setState-in-effect cascade.
  const [activeTab, setActiveTab] = useState(() => {
    if (DEMO) return 'calendar';
    const p = new URLSearchParams(window.location.search);
    return (p.get('connected') || p.get('connect_error')) ? 'settings' : 'analytics';
  }); // 'analytics' | 'calendar' | 'autopilot' | 'markiv' | 'media' | 'competitors' | 'settings'

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  // The sidebar overlays the page below 992px (see Dashboard.css), so it
  // starts closed there and closes again once a tab is picked.
  const isNarrow = () => window.matchMedia?.('(max-width: 992px)').matches;
  const [sidebarOpen, setSidebarOpen] = useState(() => !isNarrow());
  const pickTab = (tab) => {
    setActiveTab(tab);
    if (isNarrow()) setSidebarOpen(false);
  };
  const [tgStatus, setTgStatus] = useState(null);
  const [tgModalOpen, setTgModalOpen] = useState(false);
  const [igStatus, setIgStatus] = useState(null);
  const [igModalOpen, setIgModalOpen] = useState(false);
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
  // The post panel: null when closed, otherwise
  // { event } — an existing post opened from the calendar
  // { initial: { when, text, media, channel } } — a new post, optionally
  //   prefilled (a clicked day, or text sent over from Competitors)
  const [composer, setComposer] = useState(null);
  // Bumped after the post panel saves, to remount (and so refetch) the calendar.
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  // One short confirmation line ("Scheduled for Friday, 10:00.").
  const [toast, setToast] = useState('');
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(id);
  }, [toast]);
  // The Business Profile and Upgrade panes are no longer their own sidebar
  // tabs — they open as a modal from clicking the profile card / usage meter.
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  // Deferred onboarding: how many business questions are still unanswered.
  // Drives the "!" on the profile card. null until the first fetch answers, so
  // the badge never flashes on and then off.
  const [pendingQuestions, setPendingQuestions] = useState(null);

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

  // A failure leaves the badge hidden rather than showing a count we could not
  // verify — the profile panel is still reachable either way.
  const refreshCompletion = () => {
    api.get('/api/profile/completion')
      .then((d) => setPendingQuestions(d.pendingCount ?? 0))
      .catch(() => setPendingQuestions(null));
  };
  useEffect(refreshCompletion, [activeProfile]);

  useEffect(() => {
    api.get('/api/usage').then(setUsage).catch(() => setUsage(null));
  }, [activeProfile, activeTab]); // refresh when switching tabs (post-generation)

  useEffect(() => {
    async function fetchStats() {
      // DISABLED: SEO/Meta temporarily off — see 2026-08-13
      // Only the seoKeywords offline fallback below used this.
      // const cat = (activeProfile.category || 'business').toLowerCase();
      try {
        const data = await api.get('/api/dashboard/stats');
        setStats(data);
        setStatsOffline(false);
      } catch {
        // Server unreachable — show clearly-flagged offline preset data.
        setStatsOffline(true);
        // Nothing invented: the cards say they are not connected, and the
        // banner above says the server could not be reached.
        setStats({
          metrics: {
            instagramFollowers: { current: null, change: null, live: false, history: [] },
            telegramSubscribers: { current: null, change: null, live: false, history: [] },
          },
          competitors: [],
          yourPostsPerWeek: 0,
          yourChannelsConnected: 0,
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


  // Label maps for raw API/mock data values (fall back to raw value for unknown codes)
  // DISABLED: SEO/Meta temporarily off — see 2026-08-13
  // Only the Local SEO Rankings panel used these labels.
  // const volumeLabels = {
  //   'High': t('dashboard.seo.volume.high', 'High'),
  //   'Medium': t('dashboard.seo.volume.medium', 'Medium'),
  //   'Very High': t('dashboard.seo.volume.veryHigh', 'Very High')
  // };

  // NOTE: the shell deliberately carries no fade animation. `fadeIn` runs with
  // `animation-fill-mode: forwards`, which leaves `transform: translateY(0)`
  // applied for good — and a transformed ancestor makes `position: fixed`
  // children resolve against IT instead of the viewport, so both side panels
  // would scroll away with the page.
  return (
    <div className="dashboard-shell">
      {/* Tap outside the open sidebar to close it (narrow screens only, see CSS). */}
      {sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

      {/* --- SIDEBAR --- */}
      <aside className={`dashboard-sidebar ui ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div className="sb-brand">
            <img src={logoUrl} alt="" />
            <span>Markivo</span>
          </div>
          <button
            type="button"
            className="sidebar-theme"
            onClick={onToggleTheme}
            id="btn_theme_toggle"
            aria-label={theme === 'dark' ? t('common.themeToLight', 'Switch to light theme') : t('common.themeToDark', 'Switch to dark theme')}
            title={theme === 'dark' ? t('common.themeToLight', 'Switch to light theme') : t('common.themeToDark', 'Switch to dark theme')}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
          </button>
        </div>

        {/* The business — opens the Business Profile editor */}
        <button
          type="button"
          className="sb-business"
          onClick={() => setProfileModalOpen(true)}
          id="btn_open_profile"
          title={t('settings.business', 'Business profile')}
        >
          <span className="sb-avatar" aria-hidden="true">
            {activeProfile.logo?.image ? (
              <img src={activeProfile.logo.image} alt="" />
            ) : activeProfile.logo?.svg ? (
              <img src={'data:image/svg+xml;utf8,' + encodeURIComponent(activeProfile.logo.svg)} alt="" />
            ) : (
              (activeProfile.businessName || '?').trim().charAt(0).toUpperCase()
            )}
          </span>
          <span className="sb-business-text">
            <span className="sb-business-name">{activeProfile.businessName}</span>
            {pendingQuestions > 0 ? (
              <span className="sb-business-sub is-todo">
                {t('sidebar.questionsLeft', { defaultValue: '{{count}} questions left', count: pendingQuestions })}
              </span>
            ) : (
              <span className="sb-business-sub">{categoryLabel(t, activeProfile.category)}</span>
            )}
          </span>
        </button>

        <nav className="sb-nav" aria-label={t('sidebar.navLabel', 'Sections')}>
            <button
              type="button"
              className={`sb-nav-item${activeTab === 'analytics' ? ' is-active' : ''}`}
              aria-current={activeTab === 'analytics' ? 'page' : undefined}
              onClick={() => pickTab('analytics')}
              id="btn_tab_analytics"
            >
              <Icon name="chart" size={18} /> <span>{t('dashboard.nav.metrics', 'Dashboard')}</span>
            </button>
            <button
              type="button"
              className={`sb-nav-item${activeTab === 'calendar' ? ' is-active' : ''}`}
              aria-current={activeTab === 'calendar' ? 'page' : undefined}
              onClick={() => pickTab('calendar')}
              id="btn_tab_calendar"
            >
              <Icon name="calendar" size={18} /> <span>{t('dashboard.nav.calendar', 'Calendar')}</span>
            </button>
            <button
              type="button"
              className={`sb-nav-item${activeTab === 'autopilot' ? ' is-active' : ''}`}
              aria-current={activeTab === 'autopilot' ? 'page' : undefined}
              onClick={() => pickTab('autopilot')}
              id="btn_tab_autopilot"
            >
              <Icon name="robot" size={18} /> <span>{t('dashboard.nav.autopilot', 'Autopilot')}</span>
            </button>
            <button
              type="button"
              className={`sb-nav-item${activeTab === 'media' ? ' is-active' : ''}`}
              aria-current={activeTab === 'media' ? 'page' : undefined}
              onClick={() => pickTab('media')}
              id="btn_tab_media"
            >
              <Icon name="image" size={18} /> <span>{t('dashboard.nav.media', 'Media Studio')}</span>
            </button>
            <button
              type="button"
              className={`sb-nav-item${activeTab === 'competitors' ? ' is-active' : ''}`}
              aria-current={activeTab === 'competitors' ? 'page' : undefined}
              onClick={() => pickTab('competitors')}
              id="btn_tab_competitors"
            >
              <Icon name="users" size={18} /> <span>{t('dashboard.nav.competitors', 'Competitor Intel')}</span>
            </button>
            <button
              type="button"
              className={`sb-nav-item${activeTab === 'settings' ? ' is-active' : ''}`}
              aria-current={activeTab === 'settings' ? 'page' : undefined}
              onClick={() => pickTab('settings')}
              id="btn_tab_settings"
            >
              <Icon name="sliders" size={18} /> <span>{t('dashboard.settingsTab', 'Settings')}</span>
            </button>
        </nav>

        <div className="sb-footer">
          {usage && usage.buckets && (
            <button
              type="button"
              className="sb-usage"
              id="usage_meter"
              onClick={() => setUpgradeModalOpen(true)}
              title={t('usage.resetsTitle', { defaultValue: 'Resets {{date}}', date: usage.resetsAt?.slice(0, 10) })}
            >
              <span className="sb-usage-head">
                <span>{t('usage.tierPlan', { defaultValue: '{{tier}} plan', tier: t(`usage.tiers.${usage.tier}`, usage.tier) })}</span>
                <span className="sb-usage-link">{t('sidebar.upgrade', 'Upgrade')}</span>
              </span>
              {/* One bar per allowance: they are separate weekly pools. */}
              {Object.entries(usage.buckets).map(([name, b]) => (
                <span className="sb-usage-row" key={name}>
                  <span className="sb-usage-label">
                    <span>{t(`usage.buckets.${name}`, name)}</span>
                    <span>
                      {b.limit === 0
                        ? '—'
                        : t('usage.count', { defaultValue: '{{used}} / {{limit}}', used: b.used, limit: b.limit })}
                    </span>
                  </span>
                  <span className="sb-usage-track">
                    <span
                      className={`sb-usage-fill${b.limit && b.remaining <= 0 ? ' is-full' : ''}`}
                      style={{ width: `${b.limit ? Math.min(100, Math.round((b.used / b.limit) * 100)) : 0}%` }}
                    />
                  </span>
                </span>
              ))}
              <span className="sb-usage-reset">{t('usage.resetsWeekly', 'resets Monday')}</span>
            </button>
          )}
          <button type="button" className="sb-logout" onClick={onLogout} id="btn_logout">
            <Icon name="logout" size={18} /> <span>{t('sidebar.logout', 'Log out')}</span>
          </button>
        </div>
      </aside>

      {/* --- MAIN MAIN WRAPPER --- */}
      <main className="dashboard-main-content">
        {/* TOP BAR */}
        {/* Phones only: the sidebar is hidden, so this is how to open it. */}
        <div className="mobile-bar">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(true)}
            aria-label={t('dashboard.toggleSidebar', 'Show or hide the sidebar')}
            aria-expanded={sidebarOpen}
            id="btn_sidebar_open"
          >
            <Icon name="menu" size={20} />
          </button>
          <img src={logoUrl} alt="" className="mobile-bar-logo" />
          <span className="mobile-bar-name">Markivo</span>
        </div>

        {/* TABS CONTAINER */}
        <div className="tab-pane-container">
          
          {/* TAB 1: METRICS & SEARCH */}
          {activeTab === 'analytics' && (
            <div className="tab-analytics animate-fade-in">
              <header className="page-head">
                <div>
                  <h1>{t('dashboard.nav.metrics', 'Dashboard')}<InfoTip text={t('dashboard.pageSubtitle', 'How your channels are doing.')} /></h1>
                </div>
              </header>

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
                </div>
              </div>

              {/* CORE METRICS GRID */}
              <div className="grid-2 stats-grid">

                {/* INSTAGRAM FOLLOWERS */}
                <StatCard
                  id="btn_drill_instagram"
                  label={t('dashboard.stats.instagramFollowers', 'Instagram Followers')}
                  platformName="Instagram"
                  change={stats.metrics.instagramFollowers.change}
                  value={stats.metrics.instagramFollowers.current?.toLocaleString()}
                  subtitle={igStatus?.username ? `@${igStatus.username}` : ''}
                  color="var(--accent-purple)"
                  history={stats.metrics.instagramFollowers.history}
                  live={!!stats.metrics.instagramFollowers.live}
                  onConnect={() => setIgModalOpen(true)}
                  onDrill={() => setDetailPlatform('instagram')}
                />

                {/* TELEGRAM ACTIVE MEMBERS */}
                <StatCard
                  id="btn_drill_telegram"
                  label={t('dashboard.stats.telegramMembers', 'Telegram Channel Members')}
                  platformName="Telegram"
                  change={stats.metrics.telegramSubscribers.change}
                  value={stats.metrics.telegramSubscribers.current?.toLocaleString()}
                  subtitle={tgStatus?.chat?.chatTitle || ''}
                  color="var(--accent-secondary)"
                  history={stats.metrics.telegramSubscribers.history}
                  live={!!stats.metrics.telegramSubscribers.live}
                  onConnect={() => setTgModalOpen(true)}
                  onDrill={() => setDetailPlatform('telegram')}
                />
              </div>

              {/* SEARCH PERFORMANCE ROW */}
              {/* DISABLED: SEO/Meta temporarily off — see 2026-08-13 — grid-2 -> grid-1: with the SEO panel gone the AI Search panel would sit alone in a two-column row. */}
              <div className="grid-1 search-analytics-grid mt-30">
                
                {/* DISABLED: SEO/Meta temporarily off — see 2026-08-13
                    The Local SEO Rankings panel. Commented out together with the
                    backend seoKeywords payload (server.js) — stats.seoKeywords.map
                    below was unguarded, so the two must move together.
                    Inner comment markers are neutralised so this block nests. When
                    re-enabling, restore them: "[/-star" back to a JSX comment open,
                    "star-!/]" back to a JSX comment close, and "star-!/" back to a
                    plain block-comment close.

                    [/* SEO LOCAL KEYWORDS *!/]
                    <div className="seo-panel glass-card">
                    <h3>{t('dashboard.seo.title', 'Local SEO Rankings')}<InfoTip text={t('dashboard.seo.subtitle', 'How your business ranks in Tashkent search results')} /></h3>

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

                */}

                {/* DISABLED: SEO/Meta temporarily off — see 2026-08-13. The AI search
                    visibility card showed sample scores for a feature that is off. */}
              </div>

            </div>
          )}

          {/* TAB: CALENDAR — scheduling home, with the Create Post entry point */}
          {activeTab === 'calendar' && (
            <PostsCalendar
              key={calendarRefreshKey}
              activeProfile={activeProfile}
              onNewPost={(when) => setComposer({ initial: { when } })}
              onOpenPost={(event) => setComposer({ event })}
              onNotice={setToast}
            />
          )}

          {activeTab === 'autopilot' && (
            <AutonomousAgent activeProfile={activeProfile} onGoToCalendar={() => setActiveTab('calendar')} />
          )}

          {/* DISABLED: Markiv temporarily off — see 2026-08-15. TAB: MARKIV —
              the AI marketing agent, now its own tab rather than a persistent
              floating panel.
          {activeTab === 'markiv' && (
            <AIAgentSidebar activeProfile={activeProfile} telegramStatus={tgStatus} asTab onAgentReply={refreshCompletion} />
          )}
          */}

          {/* TAB 3: MEDIA STUDIO */}
          {activeTab === 'media' && (
            <MediaStudio activeProfile={activeProfile} onCompose={(initial) => setComposer({ initial })} />
          )}

          {/* TAB 4: COMPETITOR INTEL */}
          {activeTab === 'competitors' && (
            <CompetitorIntel token={token} stats={stats} activeProfile={activeProfile} onGenerateToComposer={(text) => setComposer({ initial: { text } })} />
          )}

          {/* TAB 5: SETTINGS (appearance + connections) */}
          {activeTab === 'settings' && (
            <SettingsPane
              activeProfile={activeProfile}
              theme={theme}
              onToggleTheme={onToggleTheme}
              onLanguageChange={onLanguageChange}
              onLogout={onLogout}
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
          onCompose={() => { setIgModalOpen(false); setComposer({ initial: { channel: 'instagram' } }); }}
        />
      )}

      {/* --- INSTAGRAM COMPOSER MODAL --- */}

      {/* --- PLATFORM DRILL-DOWN --- */}
      {detailPlatform && (
        <PlatformDetail
          key={detailPlatform}
          platform={detailPlatform}
          onClose={() => setDetailPlatform(null)}
          onGoToConnections={() => setActiveTab('settings')}
        />
      )}

      {/* --- POST PANEL: new post, edit, or view one that went out --- */}
      {composer && (
        <PostPanel
          activeProfile={activeProfile}
          event={composer.event || null}
          initial={composer.initial}
          onClose={() => setComposer(null)}
          onSaved={(message) => { setComposer(null); setCalendarRefreshKey((k) => k + 1); setToast(message); }}
          onGoToConnections={() => { setComposer(null); setActiveTab('settings'); }}
        />
      )}

      {toast && (
        <div className="ui ui-toast" role="status" id="toast">{toast}</div>
      )}

      {/* --- BUSINESS PROFILE MODAL (opened from the sidebar's profile card) --- */}
      {profileModalOpen && (
        <div className="auth-overlay animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) setProfileModalOpen(false); }}>
          <div className="glass-card glass-card-glow text-left side-pane-modal" role="dialog" aria-modal="true" aria-label={t('settings.business', 'Business profile')}>
            <button className="btn-close side-pane-modal-close" onClick={() => setProfileModalOpen(false)} aria-label={t('common.close', 'Close')}>
              <i className="fa-solid fa-xmark"></i>
            </button>
            <BusinessProfilePane
              activeProfile={activeProfile}
              onProfileUpdate={onProfileUpdate}
              onCompletionChange={setPendingQuestions}
            />
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
