import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import './SettingsPane.css';

const TIER_ORDER = ['freemium', 'pro', 'ultimate'];

/**
 * Dashboard "Upgrade" tab: plan & billing — pick a tier and see current usage limits.
 */
export default function UpgradePane({ onBillingChanged }) {
  const { t } = useTranslation();

  const [billing, setBilling] = useState(null); // GET /api/billing/status payload
  const [billingError, setBillingError] = useState(false);
  const [planBusy, setPlanBusy] = useState(null); // tier currently being checked out
  const [notice, setNotice] = useState(null); // { kind: 'ok'|'err', text }

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

  return (
    <div className="settings-pane animate-fade-in">
      <h2 className="settings-title">{t('settings.plan.title', 'Plan & billing')}</h2>

      {notice && (
        <div className={`settings-notice ${notice.kind}`} id="settings_notice">
          <i className={`fa-solid ${notice.kind === 'ok' ? 'fa-circle-check' : 'fa-triangle-exclamation'}`}></i> {notice.text}
        </div>
      )}

      <section className="settings-section glass-card" id="settings_plan">
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
    </div>
  );
}
