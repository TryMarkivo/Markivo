import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import LanguageSelector from './LanguageSelector';
import ThemeToggle from './ThemeToggle';
import './SettingsPane.css';

const TIER_ORDER = ['freemium', 'pro', 'ultimate'];

/**
 * Dashboard Settings tab: edit the business profile, plan & billing,
 * appearance (theme + language), and account basics.
 */
export default function SettingsPane({ activeProfile, onProfileUpdate, theme, onToggleTheme, onLanguageChange, onBillingChanged }) {
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

  const [billing, setBilling] = useState(null); // GET /api/billing/status payload
  const [billingError, setBillingError] = useState(false);
  const [planBusy, setPlanBusy] = useState(null); // tier currently being checked out

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const fetchBilling = () => {
    api.get('/api/billing/status')
      .then((data) => {
        setBilling(data);
        setBillingError(false);
      })
      .catch(() => setBillingError(true));
  };

  useEffect(fetchBilling, []);

  const handleChangePlan = async (tier) => {
    setPlanBusy(tier);
    setNotice(null);
    try {
      const data = await api.post('/api/billing/checkout', { tier });
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      if (data.upgraded) {
        setNotice({ kind: 'ok', text: t('settings.plan.changed', 'Plan updated! Your new limits are active.') });
        fetchBilling();
        onBillingChanged?.(); // refresh the sidebar usage meter immediately
      }
    } catch (err) {
      setNotice({ kind: 'err', text: err.message || t('settings.plan.changeFailed', 'Could not change your plan. Please try again.') });
    }
    setPlanBusy(null);
  };

  const tierLabels = {
    freemium: t('settings.plan.tierFree', 'Free'),
    pro: t('settings.plan.tierPro', 'Pro'),
    ultimate: t('settings.plan.tierUltimate', 'Ultimate'),
  };

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
      <section className="settings-section panel">
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

      {/* PLAN & BILLING */}
      <section className="settings-section panel" id="settings_plan">
        <h3><i className="fa-solid fa-credit-card text-accent"></i> {t('settings.plan.title', 'Plan & billing')}</h3>
        <p className="settings-hint">
          {t('settings.plan.hint', 'Your plan sets your monthly AI generation limit and unlocks advanced features.')}
        </p>

        {billing?.simulated && (
          <div className="plan-test-note" id="plan_test_mode">
            <i className="fa-solid fa-flask"></i> {t('settings.plan.testMode', 'Test mode — payments are simulated until billing keys are configured.')}
          </div>
        )}

        {billing ? (
          <>
            <div className="plan-cards">
              {TIER_ORDER.map((tier) => {
                const isCurrent = billing.tier === tier;
                const price = tier === 'freemium' ? 0 : billing.prices?.[tier] ?? 0;
                const limit = billing.limits?.[tier];
                const isUpgrade = TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(billing.tier);
                return (
                  <div key={tier} className={`plan-card ${isCurrent ? 'current' : ''}`} id={`plan_card_${tier}`}>
                    <div className="plan-card-name">{tierLabels[tier]}</div>
                    <div className="plan-card-price">
                      ${price}<span className="plan-card-per">{t('settings.plan.perMonth', '/mo')}</span>
                    </div>
                    {limit != null && (
                      <div className="plan-card-limit">
                        {t('settings.plan.limit', { defaultValue: '{{n}} AI generations / month', n: limit })}
                      </div>
                    )}
                    {isCurrent ? (
                      <span className="plan-badge">
                        <i className="fa-solid fa-circle-check"></i> {t('settings.plan.current', 'Current plan')}
                      </span>
                    ) : (
                      <button
                        className={`btn ${isUpgrade ? 'btn-primary' : 'btn-secondary'} btn-sm plan-card-btn`}
                        onClick={() => handleChangePlan(tier)}
                        disabled={planBusy !== null}
                        id={`btn_plan_change_${tier}`}
                      >
                        {planBusy === tier
                          ? t('settings.plan.working', 'Working…')
                          : isUpgrade
                            ? t('settings.plan.upgrade', 'Upgrade')
                            : t('settings.plan.downgrade', 'Downgrade')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {billing.currentPeriodEnd && (
              <p className="settings-muted plan-period">
                {t('settings.plan.periodEnd', {
                  defaultValue: 'Current period ends {{date}}',
                  date: new Date(billing.currentPeriodEnd).toLocaleDateString(),
                })}
              </p>
            )}
          </>
        ) : (
          <p className="settings-muted">
            {billingError
              ? t('settings.plan.unavailable', 'Billing status is unavailable right now.')
              : t('settings.plan.loading', 'Loading plan…')}
          </p>
        )}
      </section>

      {/* APPEARANCE */}
      <section className="settings-section panel">
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
