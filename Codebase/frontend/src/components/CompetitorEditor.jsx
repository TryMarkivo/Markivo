import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const PLATFORM_CHOICES = ['googleBusiness', 'instagram', 'telegram', 'facebook', 'tiktok', 'youtube'];

/**
 * Add or edit one competitor.
 *
 * This form is the only legitimate way follower counts and posting cadence can
 * exist in the product: Google Places does not report them, and no API we can
 * call will hand them over for an arbitrary business. So a blank field here is
 * not laziness — it is the truthful default, and it must round-trip as "not
 * reported" rather than becoming a zero. Every numeric input therefore submits
 * null when empty, and the form says so out loud.
 */
export default function CompetitorEditor({ competitor, onSave, onClose, busy = false, error = '' }) {
  const { t } = useTranslation();
  const editing = Boolean(competitor && competitor.id);

  const [form, setForm] = useState(() => ({
    name: competitor?.name || '',
    rating: competitor?.rating ?? '',
    followersCount: competitor?.followers ?? '',
    postsPerWeek: competitor?.postsPerWeek ?? '',
    address: competitor?.address || '',
    website: competitor?.website || '',
    instagramHandle: competitor?.instagramHandle || '',
    telegramChannel: competitor?.telegramChannel || '',
    notes: competitor?.notes || '',
    platformsDetected: competitor?.platforms || [],
  }));

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const togglePlatform = (key) => setForm((f) => ({
    ...f,
    platformsDetected: f.platformsDetected.includes(key)
      ? f.platformsDetected.filter((p) => p !== key)
      : [...f.platformsDetected, key],
  }));

  const submit = (e) => {
    e.preventDefault();
    if (busy) return;
    // '' -> null on the wire. The backend's numOrNull keeps it null; sending 0
    // here would publish a cadence nobody measured.
    const num = (v) => (v === '' || v === null ? null : Number(v));
    onSave({
      name: form.name.trim(),
      rating: num(form.rating),
      followersCount: num(form.followersCount),
      postsPerWeek: num(form.postsPerWeek),
      address: form.address.trim() || null,
      website: form.website.trim() || null,
      instagramHandle: form.instagramHandle.trim() || null,
      telegramChannel: form.telegramChannel.trim() || null,
      notes: form.notes.trim() || null,
      platformsDetected: form.platformsDetected,
    });
  };

  return (
    <div
      className="auth-overlay animate-fade-in"
      id="competitor_editor"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}
    >
      <div className="auth-card glass-card text-left ci-editor-card" role="dialog" aria-modal="true" aria-labelledby="ci_editor_title">
        <div className="auth-header flex-between mb-20">
          <h3 id="ci_editor_title">
            <i className="fa-solid fa-user-plus"></i>{' '}
            {editing
              ? t('competitors.form.editTitle', 'Edit competitor')
              : t('competitors.form.addTitle', 'Add a competitor')}
          </h3>
          <button
            className="btn-close" onClick={onClose} disabled={busy}
            id="btn_ci_editor_close" aria-label={t('common.close', 'Close')}
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {error && <div className="auth-error-box" role="alert">{error}</div>}

        <form onSubmit={submit}>
          <div className="form-group">
            <label htmlFor="ci_name">{t('competitors.form.name', 'Business name')}</label>
            <input
              id="ci_name" type="text" value={form.name} onChange={set('name')}
              maxLength={120} required autoFocus
              placeholder={t('competitors.form.namePlaceholder', 'e.g. Brew District')}
            />
          </div>

          <p className="ci-form-note text-muted">
            <i className="fa-solid fa-circle-info"></i>{' '}
            {t('competitors.form.unknownHint', 'Leave anything you do not know blank. A blank field is recorded as "not reported" — it never becomes a zero, and it never appears in a comparison.')}
          </p>

          <div className="ci-form-grid">
            <div className="form-group">
              <label htmlFor="ci_rating">{t('competitors.form.rating', 'Google rating')}</label>
              <input
                id="ci_rating" type="number" step="0.1" min="0" max="5"
                value={form.rating} onChange={set('rating')} placeholder="—"
              />
            </div>
            <div className="form-group">
              <label htmlFor="ci_followers">{t('competitors.form.followers', 'Followers')}</label>
              <input
                id="ci_followers" type="number" min="0" step="1"
                value={form.followersCount} onChange={set('followersCount')} placeholder="—"
              />
            </div>
            <div className="form-group">
              <label htmlFor="ci_cadence">{t('competitors.form.cadence', 'Posts per week')}</label>
              <input
                id="ci_cadence" type="number" min="0" max="200" step="0.5"
                value={form.postsPerWeek} onChange={set('postsPerWeek')} placeholder="—"
              />
            </div>
          </div>

          <div className="form-group">
            <label>{t('competitors.form.platforms', 'Channels they use')}</label>
            <div className="ci-platform-picker">
              {PLATFORM_CHOICES.map((key) => (
                <button
                  type="button"
                  key={key}
                  id={`btn_ci_plat_${key}`}
                  className={`ci-platform-chip ${form.platformsDetected.includes(key) ? 'is-on' : ''}`}
                  onClick={() => togglePlatform(key)}
                  aria-pressed={form.platformsDetected.includes(key)}
                >
                  {t(`competitors.platform.${key}`, key)}
                </button>
              ))}
            </div>
          </div>

          <div className="ci-form-grid-2">
            <div className="form-group">
              <label htmlFor="ci_ig">{t('competitors.form.instagram', 'Instagram handle')}</label>
              <input id="ci_ig" type="text" maxLength={30} value={form.instagramHandle} onChange={set('instagramHandle')} placeholder="brewdistrict" />
            </div>
            <div className="form-group">
              <label htmlFor="ci_tg">{t('competitors.form.telegram', 'Telegram channel')}</label>
              <input id="ci_tg" type="text" maxLength={64} value={form.telegramChannel} onChange={set('telegramChannel')} placeholder="@brewdistrict" />
            </div>
          </div>
          <p className="ci-form-note text-muted">
            {t('competitors.form.handlesHint', 'A public Telegram channel lets Markivo read its subscriber count for you. Instagram needs an account upgrade before it can do the same.')}
          </p>

          <div className="form-group">
            <label htmlFor="ci_address">{t('competitors.form.address', 'Address')}</label>
            <input id="ci_address" type="text" maxLength={200} value={form.address} onChange={set('address')} />
          </div>

          <div className="form-group">
            <label htmlFor="ci_notes">{t('competitors.form.notes', 'Your notes')}</label>
            <textarea
              id="ci_notes" rows={3} maxLength={500} value={form.notes} onChange={set('notes')}
              placeholder={t('competitors.form.notesPlaceholder', 'What do they do well? What do they miss?')}
            />
          </div>

          <div className="flex-end gap-10 mt-20">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy} id="btn_ci_editor_cancel">
              {t('common.cancel', 'Cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || form.name.trim().length < 2} id="btn_ci_editor_save">
              {busy ? t('competitors.actions.saving', 'Saving…') : t('competitors.actions.save', 'Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
