import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { chipMetaFor, isEditable, isReadOnly, statusOf, toEditable } from '../lib/calendarEvents';
import './AutomationCalendar.css';

const PAGE_SIZE = 8;

const FILTERS = ['all', 'scheduled', 'draft', 'published'];

/**
 * Postiz-style flat list of every post: All / Scheduled / Draft / Published
 * tabs, grouped under a date heading, paginated — independent of whatever
 * day/week/month the grid view happens to be looking at.
 */
export default function PostListView({ events, onCancel, onEditEvent, busyId }) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const matches = (ev) => filter === 'all' || statusOf(ev) === filter;
    const list = events.filter(matches);
    const ascending = filter === 'scheduled' || filter === 'draft';
    return [...list].sort((a, b) => {
      const d = new Date(a.start.dateTime) - new Date(b.start.dateTime);
      return ascending ? d : -d;
    });
  }, [events, filter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const groups = useMemo(() => {
    const out = [];
    let last = null;
    for (const ev of pageItems) {
      const key = new Date(ev.start.dateTime).toDateString();
      if (key !== last) {
        out.push({ key, date: new Date(ev.start.dateTime), items: [] });
        last = key;
      }
      out[out.length - 1].items.push(ev);
    }
    return out;
  }, [pageItems]);

  const emptyText = {
    all: t('calendar.list.emptyAll', 'No posts'),
    scheduled: t('calendar.list.emptyScheduled', 'No scheduled posts'),
    draft: t('calendar.list.emptyDraft', 'No draft posts'),
    published: t('calendar.list.emptyPublished', 'No published posts'),
  }[filter];

  return (
    <div className="post-list-view">
      <div className="plv-toolbar">
        <div className="plv-filters">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`plv-filter ${filter === f ? 'active' : ''}`}
              onClick={() => { setFilter(f); setPage(0); }}
              id={`btn_plv_filter_${f}`}
            >
              {t(`calendar.list.filter.${f}`, f[0].toUpperCase() + f.slice(1))}
            </button>
          ))}
        </div>
        <div className="plv-pager">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={clampedPage === 0}
            id="btn_plv_prev"
            aria-label={t('calendar.prevMonth', 'Previous')}
          >
            <i className="fa-solid fa-chevron-left"></i>
          </button>
          <span className="plv-page-label">{t('calendar.list.page', { defaultValue: 'Page {{page}} of {{count}}', page: clampedPage + 1, count: pageCount })}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={clampedPage >= pageCount - 1}
            id="btn_plv_next"
            aria-label={t('calendar.nextMonth', 'Next')}
          >
            <i className="fa-solid fa-chevron-right"></i>
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="text-muted plv-empty">{emptyText}</p>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="plv-group">
            <h4 className="plv-date-head">
              {g.date.toLocaleDateString(i18n.language, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </h4>
            <div className="plv-rows">
              {g.items.map((ev) => {
                const m = chipMetaFor(ev);
                const time = new Date(ev.start.dateTime).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
                const canCancel = !isReadOnly(ev) && statusOf(ev) === 'scheduled';
                const canOpen = onEditEvent && isEditable(ev);
                return (
                  <div
                    key={ev.id}
                    className={`plv-row ${canOpen ? 'is-clickable' : ''}`}
                    style={{ '--chip-color': m.color }}
                    onClick={() => canOpen && onEditEvent(toEditable(ev))}
                  >
                    <span className="plv-row-bar" />
                    <i className={m.icon} style={{ color: m.color }}></i>
                    <span className="plv-row-text">{ev.description || ev.summary}</span>
                    <span className={`plv-row-status ${statusOf(ev)}`}>{t(`calendar.list.status.${statusOf(ev)}`, statusOf(ev))}</span>
                    <span className="plv-row-time">{time}</span>
                    {canCancel && (
                      <button
                        type="button"
                        className="btn-close"
                        disabled={busyId === ev.id}
                        onClick={(e) => { e.stopPropagation(); onCancel(ev); }}
                        aria-label={t('calendar.cancelEvent', 'Cancel this post')}
                        title={t('calendar.cancelEvent', 'Cancel this post')}
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
