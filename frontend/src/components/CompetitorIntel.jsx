import { useTranslation, Trans } from 'react-i18next';
import './CompetitorIntel.css';

export default function CompetitorIntel({ stats, activeProfile }) {
  const { t } = useTranslation();
  const competitors = stats.competitors || [];
  const category = activeProfile.category || 'Cafe';

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

            {/* ACTIVE BUSINESS (YOU) */}
            <div className="comp-row active-brand">
              <span className="comp-name font-bold"><i className="fa-solid fa-circle-user text-accent"></i> {t('competitors.benchmark.you', 'You (Active Profile)')}</span>
              <span className="comp-channels">{t('competitors.benchmark.connectedCount', { defaultValue: '{{count}} Connected', count: 3 })}</span>
              <span className="comp-cadence">{t('competitors.benchmark.perWeek', { defaultValue: '{{count}} / week', count: 3 })}</span>
              <span className="comp-followers text-accent font-bold">1,542</span>
            </div>

            {/* COMPETITORS */}
            {competitors.map((comp, idx) => (
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

        {/* POST FREQUENCY CHART USING Pure SVG Bar Graphs */}
        <div className="frequency-chart-box glass-card">
          <h3>{t('competitors.frequency.title', 'Weekly Posting Frequency')}</h3>
          <p className="panel-subtitle">{t('competitors.frequency.subtitle', 'Benchmark of content frequency across competing channels')}</p>

          <div className="svg-chart-container mt-20">
            <svg viewBox="0 0 400 180" className="comp-bar-chart">
              {/* Grid Lines */}
              <line x1="50" y1="20" x2="380" y2="20" stroke="rgba(255,255,255,0.05)" />
              <line x1="50" y1="60" x2="380" y2="60" stroke="rgba(255,255,255,0.05)" />
              <line x1="50" y1="100" x2="380" y2="100" stroke="rgba(255,255,255,0.05)" />
              <line x1="50" y1="140" x2="380" y2="140" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />

              {/* Y Axis Labels */}
              <text x="40" y="24" fill="var(--text-muted)" fontSize="9" textAnchor="end">{t('competitors.frequency.axisLabel', { defaultValue: '{{count}} / wk', count: 20 })}</text>
              <text x="40" y="64" fill="var(--text-muted)" fontSize="9" textAnchor="end">{t('competitors.frequency.axisLabel', { defaultValue: '{{count}} / wk', count: 10 })}</text>
              <text x="40" y="104" fill="var(--text-muted)" fontSize="9" textAnchor="end">{t('competitors.frequency.axisLabel', { defaultValue: '{{count}} / wk', count: 5 })}</text>
              <text x="40" y="144" fill="var(--text-muted)" fontSize="9" textAnchor="end">0</text>

              {/* Bar 1: You */}
              <rect x="80" y="116" width="36" height="24" rx="4" fill="var(--accent-primary)" />
              <text x="98" y="110" fill="#fff" fontSize="9" textAnchor="middle">3</text>
              <text x="98" y="158" fill="var(--text-secondary)" fontSize="9" textAnchor="middle">{t('competitors.frequency.you', 'You')}</text>

              {/* Bar 2: Comp A */}
              <rect x="160" y="44" width="36" height="96" rx="4" fill="rgba(255,255,255,0.08)" />
              <text x="178" y="38" fill="var(--text-secondary)" fontSize="9" textAnchor="middle">12</text>
              <text x="178" y="158" fill="var(--text-secondary)" fontSize="9" textAnchor="middle" width="50">{t('competitors.frequency.compA', 'Comp A')}</text>

              {/* Bar 3: Comp B */}
              <rect x="240" y="76" width="36" height="64" rx="4" fill="rgba(255,255,255,0.08)" />
              <text x="258" y="70" fill="var(--text-secondary)" fontSize="9" textAnchor="middle">8</text>
              <text x="258" y="158" fill="var(--text-secondary)" fontSize="9" textAnchor="middle">{t('competitors.frequency.compB', 'Comp B')}</text>

              {/* Bar 4: Comp C */}
              <rect x="320" y="20" width="36" height="120" rx="4" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.15)" />
              <text x="338" y="14" fill="var(--text-secondary)" fontSize="9" textAnchor="middle">25</text>
              <text x="338" y="158" fill="var(--text-secondary)" fontSize="9" textAnchor="middle">{t('competitors.frequency.compC', 'Global C')}</text>
            </svg>
          </div>
        </div>

      </div>

      {/* GAP OPPORTUNITIES */}
      <div className="gap-analysis-row mt-30">
        <h3>{t('competitors.gaps.title', 'Actionable AI Moat Recommendations')}</h3>

        <div className="grid-2 gaps-grid mt-20">
          <div className="gap-card glass-card">
            <div className="gap-header">
              <i className="fa-solid fa-triangle-exclamation text-danger gap-icon"></i>
              <h4>{t('competitors.gaps.cadenceTitle', 'Post Cadence Alert')}</h4>
            </div>
            <p className="gap-desc">
              {competitors[0]?.postsPerWeek != null ? (
                <Trans
                  i18nKey="competitors.gaps.cadenceTextKnown"
                  defaults="Your primary local competitor <1>{{name}}</1> posts average <3>{{count}} times</3> per week. You post <5>{{yourCount}} times</5>."
                  values={{ name: competitors[0].name, count: competitors[0].postsPerWeek, yourCount: 3 }}
                  components={{ 1: <strong />, 3: <strong />, 5: <strong /> }}
                />
              ) : (
                <Trans
                  i18nKey="competitors.gaps.cadenceTextUnknown"
                  defaults="Your primary local competitor <1>{{name}}</1> is active on Google Maps{{ratingPart}}. Consistent posting is your fastest way to stand out locally."
                  values={{
                    name: competitors[0]?.name || t('competitors.gaps.nearbyFallback', 'nearby'),
                    ratingPart: competitors[0]?.rating != null
                      ? t('competitors.gaps.cadenceRating', { defaultValue: ' with a ★ {{rating}} rating', rating: competitors[0].rating })
                      : ''
                  }}
                  components={{ 1: <strong /> }}
                />
              )}
            </p>
            <div className="gap-recommendation">
              <strong>{t('competitors.gaps.solutionLabel', '💡 Solution:')}</strong> {t('competitors.gaps.cadenceSolution', 'Schedule at least 4 more AI posts in your Content Engine to close the visibility gap.')}
            </div>
          </div>

          <div className="gap-card glass-card">
            <div className="gap-header">
              <i className="fa-solid fa-magnifying-glass-plus text-success gap-icon"></i>
              <h4>{t('competitors.gaps.seoTitle', 'SEO Keyword Gaps')}</h4>
            </div>
            <p className="gap-desc">
              <Trans
                i18nKey="competitors.gaps.seoText"
                defaults='Nearby competitors are actively ranking for <1>"aesthetic {{category}} study area"</1>. You are completely missing this local search vector.'
                values={{ category: category.toLowerCase() }}
                components={{ 1: <strong /> }}
              />
            </p>
            <div className="gap-recommendation">
              <strong>{t('competitors.gaps.solutionLabel', '💡 Solution:')}</strong> {t('competitors.gaps.seoSolution', 'Include terms like "quiet study area" or "study booth" in your next generated Telegram content copy.')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
