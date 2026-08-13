import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import { PLATFORM_META } from '../lib/platforms';
import AddCompetitorModal from './AddCompetitorModal';
import './CompetitorIntel.css';

// competitor_sources platform keys -> the icon/colour catalogue already used
// for connected channels (which keys 'instagram'/'facebook' as
// 'meta_instagram'/'meta_facebook').
// DISABLED: SEO/Meta temporarily off — see 2026-08-13
// The Meta aliases are gone from PLATFORM_META, so instagram/facebook
// competitors now fall through to the generic share-icon fallback.
// const iconFor = (platform) => PLATFORM_META[platform === 'instagram' ? 'meta_instagram' : platform === 'facebook' ? 'meta_facebook' : platform];
const iconFor = (platform) => PLATFORM_META[platform];

// Facebook has no official "read a stranger's Page" API here yet — bio and
// follower count only, structurally, not a bug. Instagram is different: real
// post content IS available via Business Discovery, but only once THIS
// business has its own Instagram connected through Settings → Connections
// (the Meta/Facebook-Login card) and the competitor is itself a public
// Business/Creator account — worth explaining inline rather than leaving a
// bare "partial" badge to guess at.
// DISABLED: SEO/Meta temporarily off — see 2026-08-13
// Instagram joins this set: Business Discovery was the only way to read a
// competitor's captions, and it is disabled, so Instagram now genuinely
// exposes profile info only — same as Facebook.
// const NO_POST_API_PLATFORMS = new Set(['facebook']);
const NO_POST_API_PLATFORMS = new Set(['facebook', 'instagram']);

export default function CompetitorIntel({ stats, activeProfile, onGoToMedia }) {
  const { t } = useTranslation();
  const benchmarkCompetitors = stats.competitors || [];
  const yourPostsPerWeek = stats.yourPostsPerWeek ?? 0;
  const yourChannelsConnected = stats.yourChannelsConnected
    ?? Object.values(activeProfile.platforms || {}).filter(Boolean).length;
  const yourFollowers = stats.metrics?.instagramFollowers?.current ?? null;

  // Manually-tracked competitors (paste-a-link + fetched sources) — a
  // separate, richer fetch than the coarse benchmark list above.
  const [competitors, setCompetitors] = useState([]);
  // Only meaningful for the very first paint (whether to show the empty
  // state before the first fetch resolves) — set once, never reset to true.
  const [loadingList, setLoadingList] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [refreshingId, setRefreshingId] = useState(null);
  const [insight, setInsight] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);

  const loadCompetitors = useCallback(() => {
    api.get('/api/competitors')
      .then((data) => setCompetitors(data.competitors || []))
      .catch(() => {})
      .finally(() => setLoadingList(false));
  }, []);

  const loadTrends = useCallback(() => {
    api.get('/api/competitors/trends').then((data) => setInsight(data.insight)).catch(() => {});
  }, []);

  useEffect(() => { loadCompetitors(); loadTrends(); }, [loadCompetitors, loadTrends]);

  const handleRefresh = async (id) => {
    setRefreshingId(id);
    setError(null);
    try {
      await api.post(`/api/competitors/${id}/refresh`, {});
      loadCompetitors();
    } catch (err) {
      setError(err.message);
    }
    setRefreshingId(null);
  };

  const handleRemove = async (id) => {
    setError(null);
    try {
      await api.del(`/api/competitors/${id}`);
      loadCompetitors();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const data = await api.post('/api/competitors/analyze', {});
      setInsight(data.insight);
    } catch (err) {
      setError(err.message);
    }
    setAnalyzing(false);
  };

  const trackedWithData = competitors.filter((c) => (c.sources || []).some((s) => s.status === 'ok'));

  // Chart bars — ONLY competitors with a real, measured cadence. Never
  // invented: a competitor with no fetched posts simply doesn't get a bar.
  const chartCompetitors = [...competitors]
    .filter((c) => c.posts_per_week != null)
    .sort((a, b) => (b.posts_per_week || 0) - (a.posts_per_week || 0))
    .slice(0, 4);
  const maxCadence = Math.max(1, yourPostsPerWeek, ...chartCompetitors.map((c) => c.posts_per_week || 0));
  const barHeight = (value) => Math.round((value / maxCadence) * 110);

  return (
    <div className="competitor-intel-container animate-fade-in">
      <div className="grid-2 main-intel-grids">

        {/* COMPETING BENCHMARK TABLE */}
        <div className="benchmark-table-box glass-card">
          <h3>{t('competitors.benchmark.title', 'Local Competitor Benchmark')}</h3>
          <p className="panel-subtitle">{t('competitors.benchmark.subtitle', 'How your channel infrastructure compares to nearby local brands')}</p>

          <div className="competitor-list mt-20">
            <div className="comp-header">
              <span>{t('competitors.benchmark.colName', 'Brand Name')}</span>
              <span>{t('competitors.benchmark.colChannels', 'Channels')}</span>
              <span>{t('competitors.benchmark.colCadence', 'Cadence')}</span>
              <span>{t('competitors.benchmark.colFollowers', 'Followers')}</span>
            </div>

            {/* ACTIVE BUSINESS (YOU) — real numbers, no invented placeholders */}
            <div className="comp-row active-brand">
              <span className="comp-name font-bold"><i className="fa-solid fa-circle-user text-accent"></i> {t('competitors.benchmark.you', 'You (Active Profile)')}</span>
              <span className="comp-channels">{t('competitors.benchmark.connectedCount', { defaultValue: '{{count}} Connected', count: yourChannelsConnected })}</span>
              <span className="comp-cadence">{t('competitors.benchmark.perWeek', { defaultValue: '{{count}} / week', count: yourPostsPerWeek })}</span>
              <span className="comp-followers text-accent font-bold">{yourFollowers != null ? yourFollowers.toLocaleString() : '—'}</span>
            </div>

            {/* COMPETITORS */}
            {benchmarkCompetitors.map((comp, idx) => (
              <div key={idx} className="comp-row">
                <span className="comp-name">
                  {comp.name}
                  {comp.rating != null && <span className="text-muted">{t('competitors.benchmark.ratingSuffix', { defaultValue: ' · ★ {{rating}}', rating: comp.rating })}</span>}
                </span>
                <span className="comp-channels">{t('competitors.benchmark.channelsCount', { defaultValue: '{{count}} channels', count: comp.platformCount })}</span>
                <span className="comp-cadence">{comp.postsPerWeek != null ? t('competitors.benchmark.perWeek', { defaultValue: '{{count}} / week', count: comp.postsPerWeek }) : '—'}</span>
                <span className="comp-followers">{comp.followers != null ? comp.followers.toLocaleString() : '—'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* POST FREQUENCY CHART — real fetched cadence, or an honest empty state */}
        <div className="frequency-chart-box glass-card">
          <h3>{t('competitors.frequency.title', 'Weekly Posting Frequency')}</h3>
          <p className="panel-subtitle">{t('competitors.frequency.subtitle', 'Benchmark of content frequency across competing channels')}</p>

          {chartCompetitors.length === 0 ? (
            <div className="empty-state mt-20">
              {t('competitors.frequency.empty', 'Add a tracked competitor below and fetch their content to see a real cadence comparison here.')}
            </div>
          ) : (
            <div className="svg-chart-container mt-20">
              <svg viewBox="0 0 400 180" className="comp-bar-chart">
                <line x1="50" y1="20" x2="380" y2="20" stroke="rgba(255,255,255,0.05)" />
                <line x1="50" y1="60" x2="380" y2="60" stroke="rgba(255,255,255,0.05)" />
                <line x1="50" y1="100" x2="380" y2="100" stroke="rgba(255,255,255,0.05)" />
                <line x1="50" y1="140" x2="380" y2="140" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />

                {/* Bar 1: You (always shown) */}
                <rect x="70" y={140 - barHeight(yourPostsPerWeek)} width="36" height={barHeight(yourPostsPerWeek) || 2} rx="4" fill="var(--accent-primary)" />
                <text x="88" y={140 - barHeight(yourPostsPerWeek) - 6} fill="#fff" fontSize="9" textAnchor="middle">{yourPostsPerWeek}</text>
                <text x="88" y="158" fill="var(--text-secondary)" fontSize="9" textAnchor="middle">{t('competitors.frequency.you', 'You')}</text>

                {chartCompetitors.map((c, i) => {
                  const x = 140 + i * 70;
                  const v = c.posts_per_week || 0;
                  const h = barHeight(v) || 2;
                  return (
                    <g key={c.id}>
                      <rect x={x} y={140 - h} width="36" height={h} rx="4" fill="rgba(255,255,255,0.08)" />
                      <text x={x + 18} y={140 - h - 6} fill="var(--text-secondary)" fontSize="9" textAnchor="middle">{v}</text>
                      <text x={x + 18} y="158" fill="var(--text-secondary)" fontSize="9" textAnchor="middle">
                        {(c.competitor_name || '?').slice(0, 10)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>

      </div>

      {/* TRACKED COMPETITORS — add-by-link management */}
      <div className="tracked-competitors-row mt-30">
        <div className="flex-between mb-10">
          <div>
            <h3>{t('competitors.tracked.title', 'Tracked Competitors')}</h3>
            <p className="panel-subtitle">{t('competitors.tracked.subtitle', "Paste a competitor's profile link to pull their real content and posting habits")}</p>
          </div>
          <button className="btn btn-primary" onClick={() => setAddOpen(true)} id="btn_add_competitor">
            <i className="fa-solid fa-plus"></i> {t('competitors.tracked.addCta', 'Add competitor')}
          </button>
        </div>

        {error && <div className="auth-error-box mb-20" role="alert">{error}</div>}

        {!loadingList && competitors.length === 0 && (
          <div className="empty-state glass-card">
            {t('competitors.tracked.empty', 'No competitors tracked yet — add one by pasting their Instagram, TikTok, YouTube, or Facebook profile link.')}
          </div>
        )}

        <div className="tracked-competitor-list">
          {competitors.map((c) => (
            <div key={c.id} className="tracked-competitor-card glass-card">
              <div className="flex-between">
                <span className="font-bold">{c.competitor_name || t('competitors.tracked.unnamed', 'Unnamed competitor')}</span>
                <div className="flex-gap-8">
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => handleRefresh(c.id)}
                    disabled={refreshingId === c.id}
                    title={t('competitors.tracked.refresh', 'Refresh')}
                    aria-label={t('competitors.tracked.refresh', 'Refresh')}
                  >
                    <i className={`fa-solid fa-arrows-rotate ${refreshingId === c.id ? 'fa-spin' : ''}`}></i>
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => handleRemove(c.id)}
                    title={t('competitors.tracked.remove', 'Remove')}
                    aria-label={t('competitors.tracked.remove', 'Remove')}
                  >
                    <i className="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
              <div className="tracked-source-chips mt-10">
                {(c.sources || []).map((s) => {
                  const meta = iconFor(s.platform);
                  // DISABLED: SEO/Meta temporarily off — see 2026-08-13
                  // The Instagram branch told the owner to "connect your own
                  // Instagram in Settings → Connections (Meta)" — advice they
                  // can no longer follow, since that card is gone. Instagram
                  // now falls through to the honest no-post-API message.
                  const partialHint = s.error
                    ? s.error
                    // : s.platform === 'instagram'
                    //   ? t('competitors.tracked.partialHintInstagram', 'No post content yet — connect your own Instagram in Settings → Connections (Meta) to unlock real captions and engagement here, and make sure this competitor is a public Business or Creator account.')
                    : NO_POST_API_PLATFORMS.has(s.platform)
                      ? t('competitors.tracked.partialHintNoApi', 'This platform only exposes profile info publicly — no captions or videos, so it can\'t feed trend analysis.')
                      : t('competitors.tracked.partialHintGeneric', 'Profile found, but no posts could be read this time — try Refresh.');
                  return (
                    <span key={s.id} className={`source-chip status-${s.status}`} title={s.partial ? partialHint : (s.error || '')}>
                      <i className={meta?.icon || 'fa-solid fa-link'} style={{ color: meta?.color }}></i>
                      {s.followersCount != null ? s.followersCount.toLocaleString() : t('competitors.tracked.noFollowerData', 'no data')}
                      {s.partial && <span className="partial-badge">{t('competitors.tracked.partial', 'partial')}</span>}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* COMPETITOR TRENDS — AI narrative on top of the deterministic stats above */}
      <div className="trends-row mt-30">
        <div className="flex-between mb-10">
          <div>
            <h3>{t('competitors.trends.title', 'Competitor Trends')}</h3>
            <p className="panel-subtitle">{t('competitors.trends.subtitle', "What's working for the businesses you're tracking")}</p>
          </div>
          <button
            className="btn btn-secondary"
            onClick={handleAnalyze}
            disabled={analyzing || !trackedWithData.length}
            id="btn_analyze_trends"
            title={!trackedWithData.length ? t('competitors.trends.needData', 'Add and fetch at least one competitor first') : ''}
          >
            {analyzing ? t('competitors.trends.analyzing', 'Analyzing…') : t('competitors.trends.analyzeCta', 'Analyze trends')}
          </button>
        </div>

        {!insight?.analysis && (
          <div className="empty-state glass-card">
            {t('competitors.trends.empty', 'Add at least one competitor with fetched content, then analyze to see trends.')}
          </div>
        )}

        {insight?.analysis && (
          <div className="trends-card glass-card">
            <p className="gap-desc">{insight.analysis.analysis}</p>
            {(insight.analysis.themes || []).length > 0 && (
              <ul className="trend-themes">
                {insight.analysis.themes.map((theme, i) => <li key={i}>{theme}</li>)}
              </ul>
            )}
            {insight.analysis.recommendation && (
              <div className="gap-recommendation">
                <strong>{t('competitors.trends.recommendationLabel', '💡 Recommendation:')}</strong> {insight.analysis.recommendation}
              </div>
            )}
            {onGoToMedia && (
              <button className="btn btn-primary mt-10" onClick={onGoToMedia} id="btn_generate_from_trend">
                {t('competitors.trends.generateCta', 'Generate content from this →')}
              </button>
            )}
          </div>
        )}
      </div>

      {addOpen && (
        <AddCompetitorModal
          onClose={() => setAddOpen(false)}
          onAdded={() => { setAddOpen(false); loadCompetitors(); }}
        />
      )}
    </div>
  );
}
