import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import './Onboarding.css';

const PLATFORM_OPTIONS = [
  // DISABLED: SEO/Meta temporarily off — see 2026-08-13
  // NOTE: tracking an Instagram/Facebook competitor uses the PUBLIC page scrape,
  // which needs no Meta credentials and still works. These inputs are disabled
  // only because the maximal Meta scope was requested — re-enabling them is
  // independent of the rest of the Meta work.
  // { key: 'instagram', icon: 'fa-brands fa-instagram', placeholder: 'https://instagram.com/handle' },
  { key: 'tiktok', icon: 'fa-brands fa-tiktok', placeholder: 'https://tiktok.com/@handle' },
  { key: 'youtube', icon: 'fa-brands fa-youtube', placeholder: 'https://youtube.com/@handle' },
  { key: 'telegram', icon: 'fa-brands fa-telegram', placeholder: 'https://t.me/channelname' },
  // DISABLED: SEO/Meta temporarily off — see 2026-08-13 (see note above)
  // { key: 'facebook', icon: 'fa-brands fa-facebook', placeholder: 'https://facebook.com/page' },
];

/**
 * Manual "paste a competitor's profile link" flow — there is no official API
 * for discovering a stranger's social profiles, so the owner pastes whichever
 * links they already know. Markivo fetches whatever is publicly visible on
 * each (best-effort, no login) right after submit.
 */
export default function AddCompetitorModal({ onClose, onAdded }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [links, setLinks] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setLink = (key, value) => setLinks((prev) => ({ ...prev, [key]: value }));
  const hasAnyLink = PLATFORM_OPTIONS.some((p) => links[p.key]?.trim());

  const handleSubmit = async () => {
    const sources = PLATFORM_OPTIONS
      .filter((p) => links[p.key]?.trim())
      .map((p) => ({ platform: p.key, url: links[p.key].trim() }));
    if (!sources.length) {
      setError(t('competitors.addModal.needOneLink', 'Add at least one profile link'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/api/competitors', { name: name.trim() || undefined, sources });
      onAdded?.();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <div
      className="auth-overlay animate-fade-in"
      id="add_competitor_modal"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="auth-card glass-card glass-card-glow text-left" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-labelledby="add_competitor_title">
        <div className="auth-header flex-between mb-20">
          <h3 id="add_competitor_title"><i className="fa-solid fa-magnifying-glass-chart"></i> {t('competitors.addModal.title', 'Add a Competitor')}</h3>
          <button className="btn-close" onClick={onClose} id="btn_close_add_competitor" aria-label={t('common.close', 'Close')}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {error && <div className="auth-error-box mb-20" role="alert">{error}</div>}

        <p className="text-muted mb-20" style={{ fontSize: 13 }}>
          {t('competitors.addModal.hint', "Paste one or more of their public profile links. We'll pull whatever is publicly visible — some platforms give more than others.")}
        </p>

        <div className="form-group">
          <label className="form-label" htmlFor="inp_competitor_name">{t('competitors.addModal.nameLabel', 'Competitor name (optional)')}</label>
          <input
            type="text"
            id="inp_competitor_name"
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('competitors.addModal.namePlaceholder', 'e.g. Sunrise Cafe')}
          />
        </div>

        {PLATFORM_OPTIONS.map((p) => (
          <div className="form-group" key={p.key}>
            <label className="form-label" htmlFor={`inp_competitor_${p.key}`}>
              <i className={p.icon}></i> {t(`competitors.addModal.platform.${p.key}`, p.key.charAt(0).toUpperCase() + p.key.slice(1))}
            </label>
            <input
              type="text"
              id={`inp_competitor_${p.key}`}
              className="input-field"
              value={links[p.key] || ''}
              onChange={(e) => setLink(p.key, e.target.value)}
              placeholder={p.placeholder}
            />
          </div>
        ))}

        <button className="btn btn-primary w-full mt-10" onClick={handleSubmit} disabled={busy || !hasAnyLink} id="btn_submit_competitor">
          {busy ? t('competitors.addModal.adding', 'Adding & fetching…') : t('competitors.addModal.submitCta', 'Add competitor')}
        </button>
      </div>
    </div>
  );
}
