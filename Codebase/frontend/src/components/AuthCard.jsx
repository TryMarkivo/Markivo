import { useTranslation } from 'react-i18next';

// Categories and tones mirror the Path B wizard so a business set up inline is
// described in exactly the same vocabulary as one set up through the wizard.
const CATEGORIES = [
  ['Cafe / Coffee Shop', 'onboarding.categories.cafe'],
  ['Beauty Salon / Spa', 'onboarding.categories.beauty'],
  ['Co-working & Study Space', 'onboarding.categories.coworking'],
  ['Retail Boutique / Fashion', 'onboarding.categories.retail'],
  ['Local Restaurant / Food', 'onboarding.categories.restaurant'],
  ['Professional Tech Agency', 'onboarding.categories.tech'],
];

const TONES = [
  ['Cozy & Warm', 'onboarding.tones.cozy'],
  ['Modern & Minimalist', 'onboarding.tones.modern'],
  ['Energetic & Fast-paced', 'onboarding.tones.energetic'],
  ['Professional & Trustworthy', 'onboarding.tones.professional'],
  ['Playful & Fun', 'onboarding.tones.playful'],
  ['Luxury & Premium', 'onboarding.tones.luxury'],
];

// Shared auth form used both as the single-origin modal and as the dedicated
// login.markivo.io page. Pass `onClose` only for the modal (adds a close button
// and dialog semantics); omit it when rendered as a full page.
//
// Register is TWO steps in one card: credentials, then the business profile.
// Capturing the business inline means a new owner is fully set up (and has a
// stored business context) the moment they sign up. Login stays single-step.
export default function AuthCard({
  mode, step = 1, error, form, onChange, businessForm, onBusinessChange,
  loading, onSubmit, onSwitchMode, onClose,
}) {
  const { t } = useTranslation();
  const isRegister = mode === 'register';
  const onBusinessStep = isRegister && step === 2;

  const title = onBusinessStep
    ? t('auth.business.title', 'Tell us about your business')
    : (isRegister ? t('auth.createAccountTitle', 'Create Your Account') : t('auth.welcomeBack', 'Welcome Back'));

  const submitLabel = onBusinessStep
    ? t('auth.business.finish', 'Finish Setup')
    : (isRegister ? t('auth.continue', 'Continue') : t('auth.login', 'Sign In'));

  // Step 2 needs enough to describe the business — the backend requires a name,
  // and a description is what the business context is actually distilled from.
  const businessIncomplete = onBusinessStep
    && !(businessForm.businessName.trim() && businessForm.description.trim());

  return (
    <div className="auth-card glass-card glass-card-glow text-left" role={onClose ? 'dialog' : undefined} aria-modal={onClose ? 'true' : undefined} aria-labelledby="auth_modal_title">
      <div className="auth-header flex-between mb-20">
        <h3 id="auth_modal_title">{title}</h3>
        {onClose && (
          <button className="btn-close" onClick={onClose} id="btn_close_auth" aria-label={t('common.close', 'Close')}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        )}
      </div>

      {onBusinessStep && (
        <p className="text-muted mb-20">
          {t('auth.business.subtitle', 'Markiv uses this to write content that sounds like you — not like a template.')}
        </p>
      )}

      {error && <div className="auth-error-box mb-20" role="alert">{error}</div>}

      <form onSubmit={onSubmit}>
        {onBusinessStep ? (
          <>
            <div className="form-group">
              <label className="form-label" htmlFor="inp_biz_name">{t('auth.business.name', 'Business Name')}</label>
              <input
                type="text"
                id="inp_biz_name"
                className="input-field"
                placeholder={t('auth.business.namePlaceholder', 'e.g. Noir Cafe')}
                value={businessForm.businessName}
                onChange={(e) => onBusinessChange({ businessName: e.target.value })}
                autoFocus
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="inp_biz_category">{t('auth.business.category', 'Industry / Category')}</label>
              <select
                id="inp_biz_category"
                className="select-field"
                value={businessForm.category}
                onChange={(e) => onBusinessChange({ category: e.target.value })}
              >
                {CATEGORIES.map(([value, key]) => (
                  <option key={value} value={value}>{t(key, value)}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="inp_biz_desc">{t('auth.business.description', 'What does your business do?')}</label>
              <textarea
                id="inp_biz_desc"
                className="input-field text-area"
                rows="3"
                placeholder={t('auth.business.descriptionPlaceholder', 'e.g. A specialty coffee shop with a quiet upstairs work area.')}
                value={businessForm.description}
                onChange={(e) => onBusinessChange({ description: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="inp_biz_audience">
                {t('auth.business.audience', 'Target audience')} <span className="text-muted">{t('auth.business.optional', '(optional)')}</span>
              </label>
              <input
                type="text"
                id="inp_biz_audience"
                className="input-field"
                placeholder={t('auth.business.audiencePlaceholder', 'e.g. remote workers and students')}
                value={businessForm.audience}
                onChange={(e) => onBusinessChange({ audience: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="inp_biz_tone">
                {t('auth.business.tone', 'Tone of voice')} <span className="text-muted">{t('auth.business.optional', '(optional)')}</span>
              </label>
              <select
                id="inp_biz_tone"
                className="select-field"
                value={businessForm.tone}
                onChange={(e) => onBusinessChange({ tone: e.target.value })}
              >
                {TONES.map(([value, key]) => (
                  <option key={value} value={value}>{t(key, value)}</option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            {isRegister && (
              <div className="form-group">
                <label className="form-label" htmlFor="inp_reg_name">{t('auth.fullName', 'Full Name')}</label>
                <input
                  type="text"
                  id="inp_reg_name"
                  className="input-field"
                  placeholder={t('auth.fullNamePlaceholder', 'e.g. Alisher Usmanov')}
                  value={form.fullName}
                  onChange={(e) => onChange({ fullName: e.target.value })}
                  autoFocus={isRegister}
                  required
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="inp_auth_email">{t('auth.email', 'Email Address')}</label>
              <input
                type="email"
                id="inp_auth_email"
                className="input-field"
                placeholder={t('auth.emailPlaceholder', 'name@business.com')}
                value={form.email}
                onChange={(e) => onChange({ email: e.target.value })}
                autoFocus={!isRegister}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="inp_auth_pass">{t('auth.password', 'Password')}</label>
              <input
                type="password"
                id="inp_auth_pass"
                className="input-field"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => onChange({ password: e.target.value })}
                required
              />
            </div>
          </>
        )}

        <button type="submit" className="btn btn-primary w-full btn-lg mt-10" id="btn_auth_submit" disabled={loading || businessIncomplete}>
          {loading
            ? (<><i className="fa-solid fa-spinner fa-spin"></i> {t('common.pleaseWait', 'Please wait...')}</>)
            : submitLabel}
        </button>
      </form>

      {/* The login/register switch is hidden on the business step — the account
          already exists by then, so switching would strand it half-configured. */}
      {!onBusinessStep && (
        <div className="auth-toggle-link mt-20 text-center">
          {isRegister ? (
            <p>{t('auth.alreadyHaveAccount', 'Already have an account?')} <span onClick={() => onSwitchMode('login')} className="link-text">{t('auth.login', 'Sign In')}</span></p>
          ) : (
            <p>{t('auth.newToMarkivo', 'New to Markivo?')} <span onClick={() => onSwitchMode('register')} className="link-text">{t('auth.register', 'Create Account')}</span></p>
          )}
        </div>
      )}
    </div>
  );
}
