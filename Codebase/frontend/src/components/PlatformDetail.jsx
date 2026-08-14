import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import Sparkline from './Sparkline';
import './PlatformDetail.css';

// Presentation for the four channels the dashboard charts. Kept local rather
// than reusing lib/platforms.js, which is keyed by CONNECTOR id
// ('meta_instagram'); the dashboard metrics speak the plain platform name.
const LOOK = {
  // DISABLED: SEO/Meta temporarily off — see 2026-08-13
  // instagram: { label: 'Instagram', icon: 'fa-brands fa-instagram', color: '#E1306C' },
  telegram: { label: 'Telegram', icon: 'fa-brands fa-telegram', color: 'var(--tg-blue, #229ED9)' },
  google: { label: 'Google Business', icon: 'fa-brands fa-google', color: '#4285F4' },
  tiktok: { label: 'TikTok', icon: 'fa-brands fa-tiktok', color: 'var(--text-primary)' },
};

const num = (v, lang) => (v === null || v === undefined ? null : Number(v).toLocaleString(lang));

/**
 * The drill-down opened by clicking a metric's chart. Everything behind it is
 * blurred by the overlay so this panel is the only thing in focus.
 *
 * It shows two clearly separated things: what the PLATFORM reports (real only
 * where an integration exists) and what MARKIVO scheduled or published for that
 * channel (always real, because those are our own rows). A number the platform
 * does not report is shown as "not reported", never as a zero.
 */
export default function PlatformDetail({ platform, onClose, onGoToConnections }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const look = LOOK[platform] || { label: platform, icon: 'fa-solid fa-chart-line', color: 'var(--accent-primary)' };

  // Dashboard mounts this with key={platform}, so a different chart remounts the
  // panel and the state starts clean — no synchronous reset in the effect body.
  useEffect(() => {
    let cancelled = false;
    api.get(`/api/dashboard/platform/${platform}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message || t('common.somethingWentWrong', 'Something went wrong')); });
    return () => { cancelled = true; };
  }, [platform, t]);

  // Escape closes, and the body must not scroll behind the overlay.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // DISABLED: SEO/Meta temporarily off — see 2026-08-13
  // Only the Instagram engagement footnote read this set.
  // const unavailable = new Set(data?.unavailable || []);

  const fmtDate = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(i18n.language, {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  };

  return (
    <div
      className="pd-overlay animate-fade-in"
      id="platform_detail_overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="pd-panel glass-card" role="dialog" aria-modal="true" aria-labelledby="pd_title">
        <header className="pd-header">
          <div className="pd-identity">
            <span className="pd-icon" style={{ color: look.color }}><i className={look.icon}></i></span>
            <div>
              <h3 id="pd_title">{look.label}</h3>
              {data?.account ? (
                <small className="text-muted">
                  {data.account.url ? (
                    <a href={data.account.url} target="_blank" rel="noreferrer noopener" className="pd-handle">
                      {data.account.handle || data.account.name}
                    </a>
                  ) : (data.account.handle || data.account.name)}
                </small>
              ) : (
                <small className="text-muted">{t('platformDetail.subtitle', 'Channel statistics')}</small>
              )}
            </div>
          </div>
          <div className="pd-header-right">
            {data && (
              <span className={`pd-source ${data.live ? 'is-live' : 'is-local'}`}>
                <i className={`fa-solid ${data.live ? 'fa-tower-broadcast' : 'fa-database'}`}></i>
                {data.live
                  ? t('platformDetail.sourceLive', 'Live from {{platform}}', { platform: look.label })
                  : t('platformDetail.sourceLocal', 'Markivo records only')}
              </span>
            )}
            <button className="btn-close" onClick={onClose} aria-label={t('common.close', 'Close')} id="btn_close_platform_detail">
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
        </header>

        {error && <div className="auth-error-box" role="alert">{error}</div>}

        {!data && !error && (
          <div className="pd-loading">
            <i className="fa-solid fa-spinner fa-spin text-accent"></i>
            <span>{t('common.loading', 'Loading…')}</span>
          </div>
        )}

        {data && (
          <div className="pd-body">
            {data.notice && (
              <div className="pd-notice">
                <i className="fa-solid fa-circle-info"></i>
                {/* The server sends a code, not a sentence, so this renders in
                    the interface's own language. */}
                <span>
                  {t(`platformDetail.notice.${data.notice.code}`, { error: data.notice.error || '' })}
                </span>
                {!data.connected && onGoToConnections && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => { onClose?.(); onGoToConnections(); }}
                    id="btn_pd_connect"
                  >
                    {t('platformDetail.connect', 'Connect')}
                  </button>
                )}
              </div>
            )}

            {/* --- What the platform itself reports --- */}
            {data.headline.length > 0 && (
              <section className="pd-section">
                <h4>{t('platformDetail.accountStats', 'Account')}</h4>
                <div className="pd-stat-row">
                  {data.headline.map((h) => (
                    <div key={h.key} className="pd-stat">
                      <span className="pd-stat-label">{t(`platformDetail.stat.${h.key}`, h.key)}</span>
                      <strong className="pd-stat-value">
                        {num(h.value, i18n.language) ?? (
                          <span className="pd-unreported">{t('platformDetail.notReported', 'not reported')}</span>
                        )}
                      </strong>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* --- Recorded trend --- */}
            <section className="pd-section">
              <h4>{t('platformDetail.trend', 'Recorded trend')}</h4>
              <div className="pd-chart">
                <Sparkline history={data.history} color={look.color} label={look.label} />
              </div>
              <p className="pd-hint">
                {t('platformDetail.trendHint', 'One reading per day, recorded each time the dashboard is opened.')}
              </p>
            </section>

            {/* --- Real posts from the platform, with engagement --- */}
            {data.posts.length > 0 && (
              <section className="pd-section">
                <h4>
                  {t('platformDetail.recentPosts', 'Recent posts on {{platform}}', { platform: look.label })}
                </h4>
                <ul className="pd-posts">
                  {data.posts.map((p) => (
                    <li key={p.id} className="pd-post">
                      {p.thumbnail
                        ? <img src={p.thumbnail} alt="" className="pd-post-thumb" loading="lazy" />
                        : <span className="pd-post-thumb pd-post-thumb-empty"><i className="fa-solid fa-image"></i></span>}
                      <div className="pd-post-body">
                        <p className="pd-post-caption">{p.caption || t('platformDetail.noCaption', '(no caption)')}</p>
                        <div className="pd-post-meta">
                          <span>{fmtDate(p.timestamp)}</span>
                          {p.likes !== null && (
                            <span><i className="fa-solid fa-heart"></i> {num(p.likes, i18n.language)}</span>
                          )}
                          {p.comments !== null && (
                            <span><i className="fa-solid fa-comment"></i> {num(p.comments, i18n.language)}</span>
                          )}
                          {p.likes === null && (
                            <span className="pd-unreported">{t('platformDetail.engagementUnavailable', 'engagement not reported')}</span>
                          )}
                          {p.permalink && (
                            <a href={p.permalink} target="_blank" rel="noreferrer noopener">
                              {t('platformDetail.open', 'Open')} <i className="fa-solid fa-arrow-up-right-from-square"></i>
                            </a>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* --- What Markivo did for this channel: always real --- */}
            <section className="pd-section">
              <h4>{t('platformDetail.fromMarkivo', 'Scheduled by Markivo')}</h4>
              <div className="pd-counts">
                <span className="pd-count is-posted">
                  <strong>{data.counts.posted}</strong> {t('platformDetail.countPosted', 'published')}
                </span>
                <span className="pd-count is-scheduled">
                  <strong>{data.counts.scheduled}</strong> {t('platformDetail.countScheduled', 'queued')}
                </span>
                {data.counts.failed > 0 && (
                  <span className="pd-count is-failed">
                    <strong>{data.counts.failed}</strong> {t('platformDetail.countFailed', 'failed')}
                  </span>
                )}
              </div>

              {data.ourPosts.length === 0 ? (
                <p className="pd-hint">
                  {t('platformDetail.noneScheduled', 'Nothing scheduled for this channel yet.')}
                </p>
              ) : (
                <ul className="pd-our-posts">
                  {data.ourPosts.map((p) => (
                    <li key={p.id} className={`pd-our-post is-${p.status}`}>
                      <span className="pd-our-when">{fmtDate(p.when)}</span>
                      <p className="pd-our-text">{p.text}</p>
                      <span className="pd-our-status">
                        {p.hasMedia && <i className="fa-solid fa-paperclip" title={t('platformDetail.hasMedia', 'Has media')}></i>}
                        {t(`platformDetail.status.${p.status}`, p.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* DISABLED: SEO/Meta temporarily off — see 2026-08-13
                Instagram-specific: only it could ever report per-post
                engagement, so the Business/Creator caveat belonged on that
                panel alone. The other channels already say why they have
                nothing, in `notice`. Inner markers neutralised so this nests.

                {unavailable.has('engagement') && platform === 'instagram' && (
                <p className="pd-footnote">
                <i className="fa-solid fa-circle-info"></i>[' ']
                {t('platformDetail.engagementNote', 'Per-post likes and comments are only available for connected Instagram Business or Creator accounts. This channel does not report them.')}
                </p>
                )}
            */}
          </div>
        )}
      </div>
    </div>
  );
}
