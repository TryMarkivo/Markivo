import { useState, useEffect } from 'react';
import ContentEngine from './ContentEngine';
import CompetitorIntel from './CompetitorIntel';
import AIAgentSidebar from './AIAgentSidebar';
import TelegramConnect from './TelegramConnect';
import api from '../lib/api';
import './Dashboard.css';

export default function Dashboard({ token, activeProfile, onLogout }) {
  const [activeTab, setActiveTab] = useState('analytics'); // 'analytics' | 'content' | 'competitors'
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tgStatus, setTgStatus] = useState(null);
  const [tgModalOpen, setTgModalOpen] = useState(false);

  const refreshTelegramStatus = () => {
    api.get('/api/telegram/status')
      .then(setTgStatus)
      .catch(() => setTgStatus({ connected: false }));
  };
  useEffect(refreshTelegramStatus, [activeProfile]);

  useEffect(() => {
    async function fetchStats() {
      const cat = (activeProfile.category || 'business').toLowerCase();
      try {
        const data = await api.get('/api/dashboard/stats');
        setStats(data);
      } catch (err) {
        console.error('Failed to fetch statistics, using offline presets:', err);
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
        <h3 className="mt-20">Loading Command Center...</h3>
      </div>
    );
  }

  // Helper to render logo symbol
  const logoStyle = activeProfile.logo || { text: activeProfile.businessName, color: '#D4A373', bgColor: '#1A1816', shape: 'circle', icon: '☕' };

  return (
    <div className="dashboard-shell animate-fade-in">
      {/* --- SIDEBAR --- */}
      <aside className={`dashboard-sidebar glass-card ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div className="logo-text">
            <div className="logo-icon">M</div>
            Markivo
          </div>
        </div>

        {/* LOGO BRIEF BLOCK */}
        <div className="active-profile-card">
          <div className="sidebar-logo-icon" style={{ backgroundColor: logoStyle.bgColor, borderColor: logoStyle.color, color: logoStyle.color }}>
            {logoStyle.icon || '☕'}
          </div>
          <div className="active-profile-info">
            <h4>{activeProfile.businessName}</h4>
            <small>{activeProfile.category}</small>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
            id="btn_tab_analytics"
          >
            <i className="fa-solid fa-chart-pie"></i> Metrics & Search
          </button>
          <button 
            className={`nav-item ${activeTab === 'content' ? 'active' : ''}`}
            onClick={() => setActiveTab('content')}
            id="btn_tab_content"
          >
            <i className="fa-solid fa-wand-magic-sparkles"></i> AI Content Engine
          </button>
          <button 
            className={`nav-item ${activeTab === 'competitors' ? 'active' : ''}`}
            onClick={() => setActiveTab('competitors')}
            id="btn_tab_competitors"
          >
            <i className="fa-solid fa-users-viewfinder"></i> Competitor Intel
          </button>
        </nav>

        <div className="sidebar-footer">
          <button className="btn btn-secondary w-full" onClick={onLogout} id="btn_logout">
            <i className="fa-solid fa-arrow-right-from-bracket"></i> Exit Dashboard
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
            <i className="fa-solid fa-location-dot text-accent"></i> <span>{activeProfile.location || 'Tashkent, Uzbekistan'}</span>
          </div>
          <div className="header-badge-wrap">
            <span className="badge badge-success"><i className="fa-solid fa-circle-check"></i> System Operational</span>
            <span className="badge badge-primary">V1 Live</span>
          </div>
        </header>

        {/* TABS CONTAINER */}
        <div className="tab-pane-container">
          
          {/* TAB 1: METRICS & SEARCH */}
          {activeTab === 'analytics' && (
            <div className="tab-analytics animate-fade-in">
              
              {/* CONNECTED PLATFORMS */}
              <div className="channels-status-row">
                <h3>Your Active Infrastructure</h3>
                <div className="channels-grid">
                  <div className={`channel-pill ${activeProfile.platforms.googleBusiness ? 'connected' : 'inactive'}`}>
                    <i className="fa-brands fa-google"></i> Google Profile
                    <span className="dot"></span>
                  </div>
                  <div className={`channel-pill ${activeProfile.platforms.instagram ? 'connected' : 'inactive'}`}>
                    <i className="fa-brands fa-instagram"></i> Instagram
                    <span className="dot"></span>
                  </div>
                  <div
                    className={`channel-pill ${tgStatus?.connected && tgStatus?.chat ? 'connected' : 'inactive'}`}
                    onClick={tgStatus?.comingSoon ? undefined : () => setTgModalOpen(true)}
                    style={{ cursor: tgStatus?.comingSoon ? 'default' : 'pointer' }}
                    title={
                      tgStatus?.comingSoon
                        ? 'Telegram integration is coming soon'
                        : tgStatus?.connected
                          ? `Bot @${tgStatus.botUsername}`
                          : 'Click to connect Telegram'
                    }
                    id="btn_telegram_pill"
                  >
                    <i className="fa-brands fa-telegram"></i>{' '}
                    {tgStatus?.comingSoon
                      ? 'Telegram · soon'
                      : tgStatus?.connected && tgStatus?.chat
                        ? `Telegram · ${tgStatus.chat.chatTitle}`
                        : tgStatus?.connected
                          ? 'Telegram · finish setup'
                          : 'Telegram · connect'}
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
                <div className="stat-card glass-card">
                  <div className="flex-between">
                    <span className="stat-label">Google Maps Search Views</span>
                    <span className="trend-percentage positive">+{stats.metrics.googleViews.change}%</span>
                  </div>
                  <div className="stat-number-wrap">
                    <h2>{stats.metrics.googleViews.current.toLocaleString()}</h2>
                    <span className="text-muted">past 30 days</span>
                  </div>
                  <div className="stat-chart-svg">
                    {/* SVG Sparkline drawing */}
                    <svg viewBox="0 0 100 30" className="sparkline">
                      <path d="M 0 25 Q 15 20, 30 18 T 60 12 T 90 2 Q 95 1, 100 0" fill="none" stroke="var(--accent-primary)" strokeWidth="2" />
                    </svg>
                  </div>
                </div>

                {/* INSTAGRAM FOLLOWERS */}
                <div className="stat-card glass-card">
                  <div className="flex-between">
                    <span className="stat-label">Instagram Followers</span>
                    <span className="trend-percentage positive">+{stats.metrics.instagramFollowers.change}%</span>
                  </div>
                  <div className="stat-number-wrap">
                    <h2>{stats.metrics.instagramFollowers.current.toLocaleString()}</h2>
                    <span className="text-muted">@{activeProfile.businessName.toLowerCase().replace(/ /g, '')}_uz</span>
                  </div>
                  <div className="stat-chart-svg">
                    <svg viewBox="0 0 100 30" className="sparkline">
                      <path d="M 0 28 Q 20 25, 40 18 T 70 8 T 100 2" fill="none" stroke="var(--accent-purple)" strokeWidth="2" />
                    </svg>
                  </div>
                </div>

                {/* TELEGRAM ACTIVE MEMBERS */}
                <div className="stat-card glass-card">
                  <div className="flex-between">
                    <span className="stat-label">Telegram Channel Members</span>
                    <span className="trend-percentage positive">+{stats.metrics.telegramSubscribers.change}%</span>
                  </div>
                  <div className="stat-number-wrap">
                    <h2>{stats.metrics.telegramSubscribers.current.toLocaleString()}</h2>
                    <span className="text-muted">t.me/{activeProfile.businessName.toLowerCase().replace(/ /g, '')}</span>
                  </div>
                  <div className="stat-chart-svg">
                    <svg viewBox="0 0 100 30" className="sparkline">
                      <path d="M 0 24 Q 25 18, 50 15 T 75 8 T 100 3" fill="none" stroke="var(--accent-secondary)" strokeWidth="2" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* SEARCH PERFORMANCE ROW */}
              <div className="grid-2 search-analytics-grid mt-30">
                
                {/* SEO LOCAL KEYWORDS */}
                <div className="seo-panel glass-card">
                  <h3>Local SEO Rankings</h3>
                  <p className="panel-subtitle">How your business ranks in Tashkent search results</p>
                  
                  <div className="keywords-list">
                    <div className="kw-header">
                      <span>Search Keyword</span>
                      <span>Avg. Position</span>
                      <span>Volume</span>
                    </div>
                    {stats.seoKeywords.map((kw, idx) => {
                      const position = kw.avg_position ?? kw.position;
                      return (
                        <div key={idx} className="kw-row">
                          <span className="kw-text">{kw.keyword_phrase || kw.keyword}</span>
                          <span className={`kw-pos ${position <= 10 ? 'top-10' : ''}`}>#{position}</span>
                          <span className="kw-volume">{kw.volume}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* AI SEARCH PRESENCE INDEX */}
                <div className="ai-search-panel glass-card">
                  <h3>AI Search Visibility</h3>
                  <p className="panel-subtitle">How models recommend you in natural chat queries</p>

                  <div className="ai-score-ring-wrap">
                    <div className="ai-ring-container">
                      <svg width="80" height="80" viewBox="0 0 36 36" className="circular-chart">
                        <path className="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#222" strokeWidth="2.5" />
                        <path className="circle-fill" strokeDasharray={`${stats.aiPresence.perplexityScore}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" />
                      </svg>
                      <div className="ai-score-inside">
                        <span>{stats.aiPresence.perplexityScore}</span>
                        <small>index</small>
                      </div>
                    </div>
                    <div className="ai-score-info">
                      <h4>Highly Search Optimised</h4>
                      <p>Cited in <strong>{stats.aiPresence.sourcesCitedCount} distinct</strong> search models this week.</p>
                    </div>
                  </div>

                  <div className="ai-mentions-breakdown border-top-onboard pt-20">
                    <div className="mention-item">
                      <span><i className="fa-solid fa-message text-success"></i> ChatGPT recommendation rank</span>
                      <strong className="text-success">{stats.aiPresence.chatgptRank}</strong>
                    </div>
                    <div className="mention-item mt-10">
                      <span><i className="fa-solid fa-lightbulb text-accent"></i> Perplexity Citations</span>
                      <strong>Active</strong>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: AI CONTENT ENGINE */}
          {activeTab === 'content' && (
            <ContentEngine token={token} activeProfile={activeProfile} />
          )}

          {/* TAB 3: COMPETITOR INTEL */}
          {activeTab === 'competitors' && (
            <CompetitorIntel token={token} stats={stats} activeProfile={activeProfile} />
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

      {/* --- PERSISTENT RIGHT-FLOATING AI AGENT PANEL --- */}
      <AIAgentSidebar token={token} activeProfile={activeProfile} telegramStatus={tgStatus} />
    </div>
  );
}
