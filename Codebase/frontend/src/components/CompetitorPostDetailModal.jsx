import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PLATFORM_META } from '../lib/platforms';

const fmtCount = (n) => (n == null ? null : Number(n).toLocaleString());

/**
 * Read-only "view this post" popup opened from a tracked competitor's post
 * list in Competitor Intel — the card only has room for a truncated caption
 * and a couple of stats, so this is where the full caption and every fetched
 * metric live. Mirrors PostDetailModal's shell (same overlay/card classes),
 * but for a competitor_posts row instead of a Markivo calendar event.
 */
export default function CompetitorPostDetailModal({ post, competitorName, platform, onClose }) {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const meta = PLATFORM_META[platform] || {};
  const time = post.postedAt
    ? new Date(post.postedAt).toLocaleString(i18n.language, {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : null;
  const likes = fmtCount(post.likeCount);
  const comments = fmtCount(post.commentCount);
  const views = fmtCount(post.viewCount);

  return (
    <div className="auth-overlay animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="auth-card glass-card glass-card-glow text-left post-detail-card" role="dialog" aria-modal="true" aria-labelledby="ci_post_detail_title">
        <div className="auth-header flex-between mb-20">
          <h3 id="ci_post_detail_title">
            <i className={meta.icon || 'fa-solid fa-link'} style={{ color: meta.color }}></i> {competitorName || t('competitors.posts.detailTitle', 'Competitor post')}
          </h3>
          <button className="btn-close" onClick={onClose} id="btn_close_ci_post_detail" aria-label={t('common.close', 'Close')}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="post-detail-meta">
          {time && <span className="post-detail-time"><i className="fa-solid fa-clock"></i> {time}</span>}
        </div>

        {post.thumbnailUrl && (
          post.kind === 'video'
            ? <video src={post.thumbnailUrl} controls className="post-detail-media" />
            : <img src={post.thumbnailUrl} alt="" className="post-detail-media" />
        )}

        <p className="post-detail-text">{post.caption || t('competitors.posts.noCaption', '(no caption)')}</p>

        <div className="ci-post-detail-stats">
          {likes != null && <span><i className="fa-solid fa-heart"></i> {t('competitors.posts.likes', { defaultValue: '{{count}} likes', count: Number(post.likeCount) })}</span>}
          {comments != null && <span><i className="fa-solid fa-comment"></i> {t('competitors.posts.comments', { defaultValue: '{{count}} comments', count: Number(post.commentCount) })}</span>}
          {views != null && <span><i className="fa-solid fa-eye"></i> {t('competitors.posts.views', { defaultValue: '{{count}} views', count: Number(post.viewCount) })}</span>}
          {likes == null && comments == null && views == null && (
            <span className="ci-post-unreported">{t('competitors.posts.engagementUnavailable', 'engagement not reported')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
