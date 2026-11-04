import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import Icon, { ChannelMark } from './ui/Icon';

const channelOf = (a) => {
  if (a.action_type === 'telegram_post') return 'telegram';
  const p = a.action_payload?.platform || '';
  return p === 'meta_instagram' ? 'instagram' : p;
};

/**
 * Posts Autopilot wrote while set to "ask me first", plus any paid ad request,
 * waiting for the owner's decision. Shown on top of the calendar so every post
 * lives in one place. Approving publishes it; Skip throws it away.
 */
export default function ApprovalsStrip({ activeProfile, onChanged, onNotice }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState({}); // { [id]: text } while the owner tweaks a draft
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get('/api/autonomous/approvals')
      .then((data) => { if (!cancelled) setItems(data.approvals || []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [activeProfile?.id]);

  if (!items.length) return null;

  const decide = async (a, approve) => {
    setBusyId(a.id);
    setError('');
    try {
      const body = { approvalId: a.id };
      if (approve && typeof editing[a.id] === 'string') body.editedText = editing[a.id];
      const res = await api.post(approve ? '/api/agent/approve' : '/api/agent/reject', body);
      setItems((list) => list.filter((x) => x.id !== a.id));
      setEditing((m) => { const next = { ...m }; delete next[a.id]; return next; });
      onNotice?.(approve
        ? (res.message || t('approvals.approved', 'Approved.'))
        : t('approvals.skipped', 'Skipped. It won’t be posted.'));
      onChanged?.();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setBusyId(null);
  };

  return (
    <section className="pc-approvals" aria-labelledby="pc_approvals_title">
      <h2 id="pc_approvals_title">
        {t('approvals.title', 'Needs your OK')} <span className="pc-count">{items.length}</span>
      </h2>
      {error && <div className="ui-alert" role="alert">{error}</div>}
      <ul className="pc-approvals-list">
        {items.map((a) => {
          const p = a.action_payload || {};
          const isAd = a.action_type === 'ad_creation';
          const busy = busyId === a.id;
          const text = editing[a.id] ?? (p.text || p.creative || '');
          return (
            <li key={a.id} className={`pc-approval${isAd ? ' is-ad' : ''}`}>
              <div className="pc-approval-meta">
                {isAd ? (
                  <span className="ui-badge is-warn">{t('approvals.ad', 'Paid ad')}</span>
                ) : (
                  <>
                    <ChannelMark channel={channelOf(a)} />
                    <span>{t('approvals.fromAutopilot', 'Written by Autopilot')}</span>
                  </>
                )}
              </div>
              {isAd && <p className="pc-approval-title">{p.action}{p.target ? ` · ${p.target}` : ''}</p>}
              {typeof editing[a.id] === 'string' ? (
                <textarea
                  className="ui-textarea"
                  rows={5}
                  value={text}
                  onChange={(e) => setEditing((m) => ({ ...m, [a.id]: e.target.value }))}
                  aria-label={t('approvals.editLabel', 'Post text')}
                  id={`inp_approval_${a.id}`}
                />
              ) : (
                <p className="pc-approval-text">{text}</p>
              )}
              {isAd && p.cost && <p className="pc-approval-cost">{t('approvals.cost', 'Cost')}: <strong>{p.cost}</strong></p>}
              <div className="pc-approval-actions">
                <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy} onClick={() => decide(a, true)} id={`btn_ap_approve_${a.id}`}>
                  {busy ? <Icon name="spinner" size={14} /> : <Icon name="check" size={14} />}
                  {isAd ? t('approvals.approveAd', 'Approve spend') : t('approvals.approve', 'Approve and post')}
                </button>
                {!isAd && typeof editing[a.id] !== 'string' && (
                  <button type="button" className="ui-btn ui-btn-quiet ui-btn-sm" disabled={busy} onClick={() => setEditing((m) => ({ ...m, [a.id]: text }))}>
                    {t('approvals.edit', 'Edit')}
                  </button>
                )}
                <button type="button" className="ui-btn ui-btn-quiet ui-btn-sm" disabled={busy} onClick={() => decide(a, false)} id={`btn_ap_reject_${a.id}`}>
                  {t('approvals.skip', 'Skip')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
