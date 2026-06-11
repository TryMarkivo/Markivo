import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import LanguageSelector from './LanguageSelector';
import ThemeToggle from './ThemeToggle';
import './SettingsPane.css';

/**
 * Dashboard Settings tab: edit the business profile, appearance (theme +
 * language), and account basics. Saves via PUT /api/profile and PUT /api/me.
 */
export default function SettingsPane({ activeProfile, onProfileUpdate, theme, onToggleTheme, onLanguageChange }) {
  const { t } = useTranslation();

  const [form, setForm] = useState({
    businessName: activeProfile.businessName || '',
    category: activeProfile.category || '',
    description: activeProfile.description || '',
    location: activeProfile.location || '',
    audience: activeProfile.targetAudience || '',
    tone: activeProfile.brandTone || '',
    slogan: activeProfile.slogan || '',
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
        brandTone: form.tone,
        slogan: form.slogan,
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
      <h2 className="settings-title">{t('settings.title', 'Settings')}</h2>

      {notice && (
        <div className={`settings-notice ${notice.kind}`} id="settings_notice">
          <i className={`fa-solid ${notice.kind === 'ok' ? 'fa-circle-check' : 'fa-triangle-exclamation'}`}></i> {notice.text}
        </div>
      )}

      {/* BUSINESS PROFILE */}
      <section className="settings-section glass-card">
        <h3><i className="fa-solid fa-store text-accent"></i> {t('settings.business', 'Business profile')}</h3>
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
            <label className="form-label" htmlFor="set_tone">{t('settings.tone', 'Brand tone')}</label>
            <input id="set_tone" className="input-field" value={form.tone} onChange={set('tone')} />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="set_audience">{t('settings.audience', 'Target audience')}</label>
          <input id="set_audience" className="input-field" value={form.audience} onChange={set('audience')} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="set_slogan">{t('settings.slogan', 'Slogan')}</label>
          <input id="set_slogan" className="input-field" value={form.slogan} onChange={set('slogan')} />
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

      {/* APPEARANCE */}
      <section className="settings-section glass-card">
        <h3><i className="fa-solid fa-palette text-accent"></i> {t('settings.appearance', 'Appearance')}</h3>
        <div className="settings-row">
          <span>{t('settings.theme', 'Theme')}</span>
          <div className="settings-row-control">
            <span className="settings-muted">{theme === 'dark' ? t('settings.dark', 'Dark') : t('settings.light', 'Light')}</span>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
        </div>
        <div className="settings-row">
          <span>{t('settings.language', 'Language')}</span>
          <LanguageSelector onChange={onLanguageChange} />
        </div>
      </section>
    </div>
  );
}
