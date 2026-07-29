import { useTranslation } from 'react-i18next';

// Shared auth form used both as the single-origin modal and as the dedicated
// login.markivo.io page. Pass `onClose` only for the modal (adds a close button
// and dialog semantics); omit it when rendered as a full page.
export default function AuthCard({ mode, error, form, onChange, loading, onSubmit, onSwitchMode, onClose }) {
  const { t } = useTranslation();
  const isRegister = mode === 'register';

  return (
    <div className="auth-card panel text-left" role={onClose ? 'dialog' : undefined} aria-modal={onClose ? 'true' : undefined} aria-labelledby="auth_modal_title">
      <div className="auth-header flex-between mb-20">
        <h3 id="auth_modal_title">{isRegister ? t('auth.createAccountTitle', 'Create Your Account') : t('auth.welcomeBack', 'Welcome Back')}</h3>
        {onClose && (
          <button className="btn-close" onClick={onClose} id="btn_close_auth" aria-label={t('common.close', 'Close')}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        )}
      </div>

      {error && <div className="auth-error-box mb-20" role="alert">{error}</div>}

      <form onSubmit={onSubmit}>
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

        <button type="submit" className="btn btn-primary w-full btn-lg mt-10" id="btn_auth_submit" disabled={loading}>
          {loading
            ? (<><i className="fa-solid fa-spinner fa-spin"></i> {t('common.pleaseWait', 'Please wait...')}</>)
            : (isRegister ? t('auth.registerCta', 'Register Account') : t('auth.login', 'Sign In'))}
        </button>
      </form>

      <div className="auth-toggle-link mt-20 text-center">
        {isRegister ? (
          <p>{t('auth.alreadyHaveAccount', 'Already have an account?')} <span onClick={() => onSwitchMode('login')} className="link-text">{t('auth.login', 'Sign In')}</span></p>
        ) : (
          <p>{t('auth.newToMarkivo', 'New to Markivo?')} <span onClick={() => onSwitchMode('register')} className="link-text">{t('auth.register', 'Create Account')}</span></p>
        )}
      </div>
    </div>
  );
}
