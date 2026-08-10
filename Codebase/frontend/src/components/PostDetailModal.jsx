import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import { chipMetaFor, isEditable, isReadOnly, statusOf, tagOf, toEditable } from '../lib/calendarEvents';
import './AutomationCalendar.css';

/**
 * Read-only "view this post" popup opened from a calendar chip — the month
 * grid only has room for a couple of truncated lines per day, so this is
 * where the full text (and, for editable posts, an Edit action) lives.
 * Works for every event the calendar feed returns, not just editable ones,
 * since Autopilot history and already-published posts have nowhere else to
 * be read in full.
 */
export default function PostDetailModal({ event, onClose, onEdit, onCancel, busy }) {
  const { t, i18n } = useTranslation();
  const [media, setMedia] = useState(null);

  const mediaId = event.extendedProperties?.private?.mediaId || null;

  useEffect(() => {
    if (!mediaId) return;
    let cancelled = false;
    api.get('/api/media')
      .then((data) => {
        if (cancelled) return;
        const item = (data.items || []).find((i) => i.id === mediaId);
        if (item) setMedia({ url: item.filePath, kind: item.kind });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mediaId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const m = chipMetaFor(event);
  const platformKey = event.extendedProperties?.private?.platform || '';
  const platformLabel = platformKey
    ? platformKey.charAt(0).toUpperCase() + platformKey.slice(1)
    : t('calendar.detail.autopilot', 'Autopilot');
  const status = statusOf(event);
  const tag = tagOf(event);
  const time = new Date(event.start.dateTime).toLocaleString(i18n.language, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const canEdit = !!onEdit && isEditable(event);
  const canCancel = !!onCancel && !isReadOnly(event) && status === 'scheduled';

  return (
    <div className="auth-overlay animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="auth-card glass-card glass-card-glow text-left post-detail-card" role="dialog" aria-modal="true" aria-labelledby="post_detail_title">
        <div className="auth-header flex-between mb-20">
          <h3 id="post_detail_title">
            <i className={m.icon} style={{ color: m.color }}></i> {platformLabel}
          </h3>
          <button className="btn-close" onClick={onClose} id="btn_close_post_detail" aria-label={t('common.close', 'Close')}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="post-detail-meta">
          <span className={`plv-row-status ${status}`}>{t(`calendar.list.status.${status}`, status)}</span>
          <span className="post-detail-time"><i className="fa-solid fa-clock"></i> {time}</span>
          {tag && <span className="cal-event-tag">{tag}</span>}
        </div>

        {media && (
          media.kind === 'video'
            ? <video src={api.mediaUrl(media.url)} controls className="post-detail-media" />
            : <img src={api.mediaUrl(media.url)} alt="" className="post-detail-media" />
        )}

        <p className="post-detail-text">{event.description || event.summary}</p>

        {(canCancel || canEdit) && (
          <div className="publish-actions">
            {canCancel && (
              <button className="btn btn-secondary" disabled={busy} onClick={() => onCancel(event)} id="btn_post_detail_cancel">
                <i className="fa-solid fa-xmark"></i> {t('calendar.cancelEvent', 'Cancel this post')}
              </button>
            )}
            {canEdit && (
              <button className="btn btn-primary" onClick={() => onEdit(toEditable(event))} id="btn_post_detail_edit">
                <i className="fa-solid fa-pen"></i> {t('createPost.editTitle', 'Edit Post')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
