import { useTranslation } from 'react-i18next';
import { formatCadence } from '../lib/competitors';

/**
 * Cadence benchmark, drawn as CSS bar rows rather than an SVG chart.
 *
 * This replaced a hand-drawn SVG whose bar heights, values and labels were all
 * literals. With no charting library in the project, at most a handful of rows,
 * and business names that run long in Uzbek and Russian, a div per row wins on
 * every axis that matters here: text truncates and wraps for free, the layout
 * is responsive for free, colours come from theme tokens so light mode works by
 * construction, and a screen reader gets real text instead of <text> nodes.
 *
 * Only rows with a KNOWN cadence set the scale. An unknown is never drawn as a
 * zero-length bar — a bar of length zero reads as "they never post", which is a
 * claim nobody made. Those rows are counted underneath instead.
 */
export default function BenchmarkBars({ series = [], unknownCount = 0 }) {
  const { t } = useTranslation();

  if (!series.length) {
    return (
      <div className="ci-chart-empty">
        <i className="fa-regular fa-chart-bar"></i>
        <p>{t('competitors.chart.empty', 'No competitor has a posting cadence on file yet.')}</p>
        <p className="text-muted">
          {t('competitors.chart.emptyHint', 'Add one to a competitor and this benchmark appears. Nobody can measure it for you — Google Maps does not report how often a business posts.')}
        </p>
      </div>
    );
  }

  const max = Math.max(...series.map((s) => s.value), 1);

  return (
    <div className="ci-bars" role="list">
      {series.map((s) => {
        const pct = Math.max((s.value / max) * 100, s.value > 0 ? 2 : 0); // keep a sliver visible
        return (
          <div className={`ci-bar-row ${s.self ? 'is-self' : ''}`} key={s.id} role="listitem">
            <span className="ci-bar-label" title={s.label}>{s.label}</span>
            <span className="ci-bar-track">
              <span className="ci-bar-fill" style={{ width: `${pct}%` }} />
            </span>
            {/* `value` not `count`: cadence is a formatted string (0.75), and
                feeding that to i18next's plural resolver would miss the key. */}
            <span className="ci-bar-value">
              {t('competitors.perWeekShort', { defaultValue: '{{value}} / wk', value: formatCadence(s.value) })}
            </span>
          </div>
        );
      })}

      {unknownCount > 0 && (
        <p className="ci-bars-note text-muted">
          {t('competitors.chart.unknownList', {
            defaultValue: '{{count}} competitors have no posting cadence on file, so they are not charted.',
            count: unknownCount,
          })}
        </p>
      )}
      <p className="ci-bars-note text-muted">
        {t('competitors.chart.basis', 'Your figure counts what Markivo published. A competitor\'s is whatever you recorded for them.')}
      </p>
    </div>
  );
}
