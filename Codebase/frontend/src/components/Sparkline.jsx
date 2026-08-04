import { useId } from 'react';
import { useTranslation } from 'react-i18next';

// The drawing box. Points are placed in these coordinates and the SVG scales to
// its container, so the curve keeps its shape at any card width.
const W = 100;
const H = 32;
const PAD_Y = 4; // keeps the stroke from clipping at the top and bottom edges

/**
 * A line chart of one metric's recorded history.
 *
 * The y-axis is scaled to THIS series' own min/max rather than a fixed range,
 * so a metric that moves between 4300 and 4400 is as readable as one that moves
 * between 0 and 5000. A flat series is drawn down the middle instead of pinned
 * to an edge, which is what a naive (v - min) / (max - min) does when the range
 * is zero.
 *
 * `history` is [{ day, value }], oldest first.
 */
export default function Sparkline({ history, color = 'var(--accent-primary)', label }) {
  const { t } = useTranslation();
  const gradientId = useId();

  const points = (history || []).filter((p) => Number.isFinite(Number(p.value)));

  // One reading is a dot, not a trend — say so rather than draw a fake line.
  if (points.length < 2) {
    return (
      <div className="sparkline-empty text-muted">
        <i className="fa-solid fa-hourglass-half"></i>{' '}
        {t('dashboard.stats.collecting', 'Collecting data…')}
      </div>
    );
  }

  const values = points.map((p) => Number(p.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  const x = (i) => (i / (points.length - 1)) * W;
  const y = (v) =>
    range === 0
      ? H / 2                                     // flat line, centred
      : PAD_Y + (1 - (v - min) / range) * (H - PAD_Y * 2);

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(' ');
  // Close the path down to the baseline for the soft fill under the curve.
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;

  const lastIndex = points.length - 1;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="sparkline"
      preserveAspectRatio="none"
      role="img"
      aria-label={label || t('dashboard.stats.trendLabel', 'Trend')}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={area} fill={`url(#${gradientId})`} stroke="none" />
      {/* vectorEffect keeps the stroke 2px even though preserveAspectRatio
          stretches the box non-uniformly to fill the card. */}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x(lastIndex)} cy={y(values[lastIndex])} r="2" fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
