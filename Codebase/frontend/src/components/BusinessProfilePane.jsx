import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import ProfileCompletion from './ProfileCompletion';
import LogoPicker from './LogoPicker';
import './SettingsPane.css';

/**
 * Dashboard "Business Profile" tab: edit the details Markivo uses to
 * personalize content, insights, and the Markiv agent.
 *
 * Two halves. Below is what signup collected and the owner can correct. Above
 * is what signup deliberately skipped — the deferred questions and the logo —
 * which is what the "!" on the profile icon is pointing at.
 */
export default function BusinessProfilePane({ activeProfile, onProfileUpdate, onCompletionChange }) {
  const { t } = useTranslation();

  // Brand tone and slogan are deliberately absent: they are deferred questions
  // now, edited in ProfileCompletion. Two inputs for one value would be two
  // sources of truth.
  const [form, setForm] = useState({
    businessName: activeProfile.businessName || '',
    category: activeProfile.category || '',
    description: activeProfile.description || '',
    location: activeProfile.location || '',
    audience: activeProfile.targetAudience || '',
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { kind: 'ok'|'err', text }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSaveBusiness = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const data = await api.put('/api/profile', {
        businessName: form.businessName,
        category: form.category,
        description: form.description,
        location: form.location,
        targetAudience: form.audience,
      });
      onProfileUpdate?.(data.profile);
      setNotice({ kind: 'ok', text: t('settings.saved', 'Saved! Your business profile is updated.') });
    } catch (err) {
      setNotice({ kind: 'err', text: err.message || t('settings.saveFailed', 'Could not save. Please try again.') });
    }
    setBusy(false);
  };

  return (
    <div className="settings-pane animate-fade-in">
      <h2 className="settings-title">{t('settings.business', 'Business profile')}</h2>

      {notice && (
        <div className={`settings-notice ${notice.kind}`} id="settings_notice">
          <i className={`fa-solid ${notice.kind === 'ok' ? 'fa-circle-check' : 'fa-triangle-exclamation'}`}></i> {notice.text}
        </div>
      )}

      <ProfileCompletion onCountChange={onCompletionChange} onProfileUpdate={onProfileUpdate} />

      <LogoPicker activeProfile={activeProfile} onProfileUpdate={onProfileUpdate} />

      <section className="settings-section glass-card">
        <p className="settings-hint">
          {t('settings.businessHint', 'Markivo personalizes content, insights, and the Markiv agent from these details.')}
        </p>

        <div className="grid-2 settings-grid">
          <div className="form-group">
            <label className="form-label" htmlFor="set_name">{t('settings.businessName', 'Business name')}</label>
            <input id="set_name" className="input-field" value={form.businessName} onChange={set('businessName')} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="set_category">{t('settings.category', 'Category')}</label>
            <input id="set_category" className="input-field" value={form.category} onChange={set('category')} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="set_location">{t('settings.location', 'Location')}</label>
            <input id="set_location" className="input-field" value={form.location} onChange={set('location')} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="set_audience">{t('settings.audience', 'Target audience')}</label>
            <input id="set_audience" className="input-field" value={form.audience} onChange={set('audience')} />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="set_description">{t('settings.description', 'Business description')}</label>
          <textarea
            id="set_description"
            className="input-field settings-textarea"
            rows={4}
            value={form.description}
            onChange={set('description')}
            placeholder={t('settings.descriptionPh', 'What you offer, what makes you special, who you serve…')}
          />
        </div>

        <button className="btn btn-primary" onClick={handleSaveBusiness} disabled={busy} id="btn_save_business">
          {busy ? t('settings.saving', 'Saving…') : t('settings.save', 'Save changes')}
        </button>
      </section>
    </div>
  );
}
