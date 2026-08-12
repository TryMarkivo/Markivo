import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import { benchmarkSeries, unknownCadenceCount, isUnknown, sourceOf, formatCount, formatCadence } from '../lib/competitors';
import BenchmarkBars from './BenchmarkBars';
import CompetitorEditor from './CompetitorEditor';
import './CompetitorIntel.css';

/**
 * Competitor Intel.
 *
 * The panel is deliberately split in two, and the split is the point:
 *
 *   "What we measured" is arithmetic over records we hold — our own published
 *   posts, ratings from Google Places, subscriber counts read from a public
 *   channel, and figures the owner entered by hand. Every one of those can be
 *   traced to a source, and the table badges which.
 *
 *   "Market brief" is a model's inference about the category and location. It
 *   never names a competitor, it costs a generation, it only runs when asked,
 *   and it renders its own caveats.
 *
 * Anything nobody measured shows as "not reported". It is never a zero, and it
 * never enters a comparison — a fabricated cadence is a number an owner would
 * act on.
 */
export default function CompetitorIntel({ activeProfile, onGoToCalendar, onGoToConnections }) {
  const { t, i18n } = useTranslation();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  const [busyId, setBusyId] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [editing, setEditing] = useState(null);     // null | {} (new) | row (edit)
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);

  const [brief, setBrief] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Loading is only true for the first fetch. A refresh after a save keeps the
  // current rows on screen rather than flashing a spinner over them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [core, insights] = await Promise.all([
          api.get('/api/competitors'),
          api.get('/api/competitors/insights').catch(() => ({ brief: null })),
        ]);
        if (cancelled) return;
        setLoadError('');
        setData(core);
        setBrief(insights.brief || null);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || t('competitors.loadError', "Couldn't load competitor intel."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeProfile?.id, reloadToken, t]);

  const say = (message, isError = false) => { setNotice(message); setNoticeError(isError); };

  const save = async (payload) => {
    setSaving(true);
    setFormError('');
    try {
      if (editing && editing.id) await api.put(`/api/competitors/${editing.id}`, payload);
      else await api.post('/api/competitors', payload);
      setEditing(null);
      say(t('competitors.actions.saved', 'Saved.'));
      refresh();
    } catch (err) {
      setFormError(err.message || t('competitors.saveError', "Couldn't save that competitor."));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(t('competitors.actions.removeConfirm', { defaultValue: 'Stop tracking {{name}}?', name: row.name }))) return;
    setBusyId(row.id);
    try {
      await api.del(`/api/competitors/${row.id}`);
      say(t('competitors.actions.removed', 'Removed.'));
      refresh();
    } catch (err) {
      say(err.message || t('competitors.saveError', "Couldn't save that competitor."), true);
    } finally {
      setBusyId(null);
    }
  };

  const enrich = async (row) => {
    setBusyId(row.id);
    try {
      const out = await api.post(`/api/competitors/${row.id}/enrich`, {});
      const failed = Object.entries(out.report || {}).filter(([, r]) => !r.ok);
      const measured = Object.values(out.report || {}).some((r) => r.ok);
      if (measured) say(t('competitors.enrich.done', 'Updated from a public channel.'));
      else if (failed.length) {
        const [name, r] = failed[0];
        say(t(`competitors.enrich.${r.reason}`, {
          defaultValue: t('competitors.enrich.failed', 'Nothing could be read for this competitor.'),
          source: t(`competitors.platform.${name}`, name),
        }), true);
      }
      refresh();
    } catch (err) {
      say(err.message || t('competitors.enrich.failed', 'Nothing could be read for this competitor.'), true);
    } finally {
      setBusyId(null);
    }
  };

  const findNearby = async () => {
    setScanning(true);
    try {
      const out = await api.post('/api/competitors/refresh', {});
      if (out.reason) say(t(`competitors.refresh.${out.reason}`, t('competitors.refresh.failed', 'Nearby search is unavailable right now.')), true);
      else say(t('competitors.refresh.done', { defaultValue: 'Found {{count}} nearby — {{added}} new.', count: out.refreshed, added: out.added }));
      refresh();
    } catch (err) {
      say(err.message || t('competitors.refresh.failed', 'Nearby search is unavailable right now.'), true);
    } finally {
      setScanning(false);
    }
  };

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const out = await api.post('/api/competitors/insights', {});
      setBrief(out.brief);
      say(t('competitors.brief.done', 'Market brief updated.'));
    } catch (err) {
      say(err.message || t('competitors.brief.failed', "Couldn't generate a market brief."), true);
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) {
    return (
      <div className="ci-loading">
        <div className="spinner"></div>
        <p className="text-muted">{t('competitors.loading', 'Loading competitor intel…')}</p>
      </div>
    );
  }

  const rows = data?.competitors || [];
  const you = data?.you || null;
  const gaps = data?.gaps || [];
  const discovery = data?.discovery || { available: false, reason: null };
  const series = benchmarkSeries(you, rows);
  const unknownCount = unknownCadenceCount(rows);
  const locale = i18n.language;

  const notReported = <span className="ci-unreported">{t('competitors.notReported', 'not reported')}</span>;

  const sourceChip = (row) => (
    <span className={`ci-source-chip ci-source-${row.source}`} title={t(`competitors.sourceHint.${row.source}`, '')}>
      {t(`competitors.source.${row.source}`, row.source)}
    </span>
  );

  return (
    <div className="competitor-intel-container animate-fade-in">
      {/* ---------- HEADER ---------- */}
      <div className="ci-header flex-between">
        <div>
          <h3>{t('competitors.title', 'Competitor Intel')}</h3>
          <p className="panel-subtitle">
            {t('competitors.subtitle', 'What we can actually measure about the businesses you compete with.')}
          </p>
        </div>
        <div className="ci-header-actions">
          <button className="btn btn-secondary" id="btn_ci_add" onClick={() => { setFormError(''); setEditing({}); }}>
            <i className="fa-solid fa-plus"></i> {t('competitors.actions.add', 'Add competitor')}
          </button>
          <button
            className="btn btn-primary" id="btn_ci_scan"
            onClick={findNearby}
            disabled={scanning || !discovery.available}
            title={discovery.available ? '' : t(`competitors.refresh.${discovery.reason}`, '')}
          >
            <i className={`fa-solid ${scanning ? 'fa-spinner fa-spin' : 'fa-location-crosshairs'}`}></i>{' '}
            {scanning ? t('competitors.actions.refreshing', 'Searching…') : t('competitors.actions.refresh', 'Find nearby')}
          </button>
        </div>
      </div>

      {!discovery.available && discovery.reason && (
        <p className="ci-discovery-note text-muted">
          <i className="fa-solid fa-circle-info"></i>{' '}
          {t(`competitors.refresh.${discovery.reason}`, 'Nearby search is unavailable right now.')}
        </p>
      )}

      {loadError && (
        <div className="auth-error-box" role="alert">
          {loadError}{' '}
          <button className="btn btn-secondary btn-sm" id="btn_ci_retry" onClick={refresh}>
            {t('competitors.retry', 'Retry')}
          </button>
        </div>
      )}

      {notice && (
        <div className={`ci-notice ${noticeError ? 'is-error' : ''}`} role="status">
          {notice}
          <button className="btn-close" onClick={() => setNotice('')} aria-label={t('common.close', 'Close')}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
      )}

      {/* ---------- EMPTY STATE ---------- */}
      {rows.length === 0 ? (
        <div className="ci-empty glass-card">
          <i className="fa-solid fa-users-viewfinder"></i>
          <h4>{t('competitors.empty.title', 'No competitors tracked yet')}</h4>
          <p className="text-muted">
            {t('competitors.empty.body', 'Add the businesses you actually compete with, or let Markivo find the nearby ones on Google Maps.')}
          </p>
          <div className="ci-empty-actions">
            <button className="btn btn-secondary" id="btn_ci_empty_add" onClick={() => { setFormError(''); setEditing({}); }}>
              {t('competitors.empty.addBtn', 'Add one manually')}
            </button>
            <button className="btn btn-primary" id="btn_ci_empty_scan" onClick={findNearby} disabled={scanning || !discovery.available}>
              {t('competitors.empty.scanBtn', 'Find nearby businesses')}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid-2 main-intel-grids">
          {/* ---------- BENCHMARK TABLE ---------- */}
          <div className="benchmark-table-box glass-card">
            <h3>{t('competitors.benchmark.title', 'Local Competitor Benchmark')}</h3>
            <p className="panel-subtitle">{t('competitors.benchmark.subtitle', 'How your channels compare to the businesses nearby')}</p>

            <div className="competitor-list mt-20">
              <div className="comp-header">
                <span>{t('competitors.benchmark.colName', 'Brand Name')}</span>
                <span>{t('competitors.benchmark.colChannels', 'Channels')}</span>
                <span>{t('competitors.benchmark.colCadence', 'Cadence')}</span>
                <span>{t('competitors.benchmark.colFollowers', 'Followers')}</span>
                <span></span>
              </div>

              {you && (
                <div className="comp-row active-brand">
                  <span className="comp-name font-bold">
                    <i className="fa-solid fa-circle-user text-accent"></i> {you.name}
                    {you.rating != null && (
                      <span className="text-muted">{t('competitors.benchmark.ratingSuffix', { defaultValue: ' · ★ {{rating}}', rating: you.rating })}</span>
                    )}
                  </span>
                  <span className="comp-channels">
                    {t('competitors.benchmark.connectedCount', { defaultValue: '{{count}} Connected', count: you.channels.connected })}
                  </span>
                  <span className="comp-cadence" title={t('competitors.you.cadenceHint', 'Counts only what Markivo published.')}>
                    {t('competitors.benchmark.perWeek', { defaultValue: '{{value}} / week', value: formatCadence(you.postsPerWeek) })}
                  </span>
                  <span className="comp-followers text-accent font-bold">
                    {you.followers != null ? formatCount(you.followers, locale) : notReported}
                  </span>
                  <span></span>
                </div>
              )}

              {rows.map((row) => (
                <div className="comp-row" key={row.id}>
                  <span className="comp-name">
                    {row.name}
                    {row.rating != null && (
                      <span className="text-muted">{t('competitors.benchmark.ratingSuffix', { defaultValue: ' · ★ {{rating}}', rating: row.rating })}</span>
                    )}
                    {sourceChip(row)}
                  </span>
                  <span className="comp-channels">
                    {t('competitors.benchmark.channelsCount', { defaultValue: '{{count}} channels', count: row.platformCount })}
                  </span>
                  <span className="comp-cadence">
                    {isUnknown(row, 'postsPerWeek')
                      ? notReported
                      : t('competitors.benchmark.perWeek', { defaultValue: '{{value}} / week', value: formatCadence(row.postsPerWeek) })}
                  </span>
                  <span className="comp-followers">
                    {isUnknown(row, 'followers') ? notReported : (
                      <>
                        {formatCount(row.followers, locale)}
                        {sourceOf(row, 'followers') === 'telegram' && (
                          <i className="fa-brands fa-telegram ci-measured" title={t('competitors.measuredBy.telegram', 'Read from their public Telegram channel')}></i>
                        )}
                      </>
                    )}
                  </span>
                  <span className="ci-row-actions">
                    {(row.telegramChannel || row.instagramHandle) && (
                      <button
                        className="ci-icon-btn" id={`btn_ci_enrich_${row.id}`}
                        onClick={() => enrich(row)} disabled={busyId === row.id}
                        title={t('competitors.actions.enrich', 'Read public numbers')}
                      >
                        <i className={`fa-solid ${busyId === row.id ? 'fa-spinner fa-spin' : 'fa-rotate'}`}></i>
                      </button>
                    )}
                    <button
                      className="ci-icon-btn" id={`btn_ci_edit_${row.id}`}
                      onClick={() => { setFormError(''); setEditing(row); }} disabled={busyId === row.id}
                      title={t('competitors.actions.edit', 'Edit')}
                    >
                      <i className="fa-solid fa-pen"></i>
                    </button>
                    <button
                      className="ci-icon-btn is-danger" id={`btn_ci_remove_${row.id}`}
                      onClick={() => remove(row)} disabled={busyId === row.id}
                      title={t('competitors.actions.remove', 'Remove')}
                    >
                      <i className="fa-solid fa-trash"></i>
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ---------- CADENCE CHART ---------- */}
          <div className="frequency-chart-box glass-card">
            <h3>{t('competitors.frequency.title', 'Weekly Posting Frequency')}</h3>
            <p className="panel-subtitle">{t('competitors.frequency.subtitle', 'Only businesses with a known cadence appear here')}</p>
            <div className="mt-20">
              <BenchmarkBars series={series} unknownCount={unknownCount} />
            </div>
          </div>
        </div>
      )}

      {/* ---------- MEASURED GAPS ---------- */}
      {gaps.length > 0 && (
        <div className="ci-section mt-30">
          <h3>{t('competitors.gaps.measuredTitle', 'What we measured')}</h3>
          <p className="panel-subtitle">{t('competitors.gaps.measuredSubtitle', 'Derived from your own records and the numbers on file — no guesswork.')}</p>

          <div className="ci-gap-grid mt-20">
            {gaps.map((g) => (
              <div className={`gap-card glass-card sev-${g.severity}`} key={g.code}>
                <div className="gap-header">
                  <i className={`fa-solid ${g.severity === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-info'} gap-icon`}></i>
                  <h4>{t(`competitors.gaps.item.${g.code}.title`, g.code)}</h4>
                </div>
                <p className="gap-desc">{t(`competitors.gaps.item.${g.code}.body`, { ...g.metrics, defaultValue: '' })}</p>
                {(g.code === 'cadenceBehind' || g.code === 'noPublishedPosts' || g.code === 'keywordsUnused') && onGoToCalendar && (
                  <button className="btn btn-secondary btn-sm" id={`btn_ci_fix_${g.code}`} onClick={onGoToCalendar}>
                    {t('competitors.gaps.goToCalendar', 'Open the calendar')}
                  </button>
                )}
                {g.code === 'channelGap' && onGoToConnections && (
                  <button className="btn btn-secondary btn-sm" id="btn_ci_fix_channelGap" onClick={onGoToConnections}>
                    {t('competitors.gaps.goToConnections', 'Manage channels')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- MARKET BRIEF (inference — kept visually apart) ---------- */}
      <div className="ci-section ci-brief mt-30">
        <div className="flex-between">
          <div>
            <h3>{t('competitors.brief.title', 'Market brief')}</h3>
            <p className="panel-subtitle">
              {t('competitors.brief.subtitle', 'An AI read on your category and area. This is informed guesswork, not measurement.')}
            </p>
          </div>
          <button className="btn btn-secondary" id="btn_ci_analyze" onClick={analyze} disabled={analyzing}>
            <i className={`fa-solid ${analyzing ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>{' '}
            {analyzing
              ? t('competitors.brief.analyzing', 'Thinking…')
              : (brief ? t('competitors.brief.regenerate', 'Regenerate') : t('competitors.brief.analyze', 'Generate'))}
          </button>
        </div>

        {!brief ? (
          <div className="ci-brief-empty glass-card mt-20">
            <p className="text-muted">{t('competitors.brief.neverRun', 'No brief yet. Generating one uses an AI generation from your monthly allowance.')}</p>
          </div>
        ) : (
          <div className="glass-card ci-brief-card mt-20">
            <span className={`ci-engine-chip ${brief.engine === 'gemini' ? 'is-live' : 'is-local'}`}>
              {brief.engine === 'gemini'
                ? t('competitors.brief.engine.gemini', 'AI-researched')
                : t('competitors.brief.engine.template', 'Offline template')}
            </span>

            <p className="ci-brief-snapshot">{brief.marketSnapshot}</p>

            {brief.contentGaps?.length > 0 && (
              <section>
                <h4>{t('competitors.brief.contentGaps', 'Openings')}</h4>
                <ul>
                  {brief.contentGaps.map((g, i) => (
                    <li key={i}><strong>{g.gap}</strong> — {g.opportunity}</li>
                  ))}
                </ul>
              </section>
            )}

            {brief.seasonalHooks?.length > 0 && (
              <section>
                <h4>{t('competitors.brief.seasonalHooks', 'Seasonal hooks')}</h4>
                <ul>
                  {brief.seasonalHooks.map((h, i) => (
                    <li key={i}><strong>{h.hook}</strong> <span className="text-muted">({h.window})</span> — {h.idea}</li>
                  ))}
                </ul>
              </section>
            )}

            {brief.competitorPlaybook?.length > 0 && (
              <section>
                <h4>{t('competitors.brief.competitorPlaybook', 'What similar businesses typically do')}</h4>
                <ul>{brief.competitorPlaybook.map((p, i) => <li key={i}>{p}</li>)}</ul>
              </section>
            )}

            {/* The model's own declared caveats. Shown, never buried. */}
            {brief.groundingFlags?.length > 0 && (
              <section className="ci-grounding">
                <h4><i className="fa-solid fa-triangle-exclamation"></i> {t('competitors.brief.groundingTitle', 'Treat with caution')}</h4>
                <ul>{brief.groundingFlags.map((f, i) => <li key={i}>{f}</li>)}</ul>
              </section>
            )}
          </div>
        )}
      </div>

      {editing && (
        <CompetitorEditor
          competitor={editing.id ? editing : null}
          onSave={save}
          onClose={() => { setEditing(null); setFormError(''); }}
          busy={saving}
          error={formError}
        />
      )}
    </div>
  );
}
