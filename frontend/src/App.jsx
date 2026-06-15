import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import LandingPage from './components/LandingPage';
import OnboardingPathA from './components/OnboardingPathA';
import OnboardingPathB from './components/OnboardingPathB';
import Dashboard from './components/Dashboard';
import LanguageSelector from './components/LanguageSelector';
import ThemeToggle from './components/ThemeToggle';
import api from './lib/api';
import './App.css';
import './i18n/i18n';

export default function App() {
  const { t } = useTranslation();
  const [view, setView] = useState('landing'); // 'landing' | 'onboarding_A' | 'onboarding_B' | 'dashboard'
  const [activeProfile, setActiveProfile] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('markivo_theme') || 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('markivo_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  
  // Auth state
  const [token, setToken] = useState(api.tokens.access() || null);
  const [authModal, setAuthModal] = useState(null); // null | 'login' | 'register'
  const [authForm, setAuthForm] = useState({ email: '', password: '', fullName: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authPathTarget, setAuthPathTarget] = useState('B'); // Onboarding Path targeted after login

  const handleLogout = () => {
    api.logout();
    setToken(null);
    setActiveProfile(null);
    setView('landing');
  };

  // Persist the language choice on the account when signed in (best-effort).
  const handleLanguageChange = (lng) => {
    if (api.tokens.access()) {
      api.put('/api/me', { preferredLang: lng }).catch(() => {});
    }
  };

  // Validate the stored session and route to the dashboard if already onboarded.
  // Initial state defaults (landing / null) already cover the no-token case.
  useEffect(() => {
    if (!token) return;

    async function verifySession() {
      try {
        await api.get('/api/auth/me'); // validates the token (refreshes if needed)

        const profileData = await api.get('/api/onboarding/active');
        if (profileData && profileData.onboarded) {
          setActiveProfile(profileData);
          setView('dashboard');
        } else {
          // Not onboarded: restore landing on app load, but never stomp an
          // onboarding flow the user just entered (this effect also fires
          // right after register/login sets the token).
          setView((v) => (v === 'onboarding_A' || v === 'onboarding_B' ? v : 'landing'));
        }
      } catch (err) {
        // Network offline: keep the current view; offline fallbacks handle the UX.
        // Otherwise the session is invalid/expired and refresh failed — sign out.
        if (!err.isNetwork) {
          handleLogout();
        }
      }
    }
    verifySession();
  }, [token]);

  // Close the auth modal on Escape for keyboard accessibility.
  useEffect(() => {
    if (!authModal) return;
    const onKey = (e) => { if (e.key === 'Escape') setAuthModal(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authModal]);

  const handleStartOnboarding = (path) => {
    setAuthPathTarget(path);
    if (!token) {
      setAuthModal('register');
    } else if (activeProfile) {
      setView('dashboard');
    } else {
      setView(path === 'A' ? 'onboarding_A' : 'onboarding_B');
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      const data = authModal === 'register'
        ? await api.register(authForm)
        : await api.login({ email: authForm.email, password: authForm.password });

      setToken(data.accessToken || data.token);
      setAuthModal(null);
      setAuthForm({ email: '', password: '', fullName: '' });

      // Navigate to onboarding if not already onboarded
      setView(authPathTarget === 'A' ? 'onboarding_A' : 'onboarding_B');
    } catch (err) {
      setAuthError(
        err.isNetwork
          ? t('auth.networkError', 'Could not reach the server. Please ensure the backend is running.')
          : (err.message || t('auth.failed', 'Authentication failed'))
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleOnboardSuccess = (profile) => {
    setActiveProfile(profile);
    setView('dashboard');
  };

  return (
    <div className="app-container">
      {/* Decorative moving backdrop blur blobs */}
      <div className="bg-blobs">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
        <div className="blob blob-3"></div>
      </div>

      {/* CONDITIONAL RENDER WORKSPACES */}
      {view === 'landing' && (
        <>
          <div className="floating-controls">
            <LanguageSelector onChange={handleLanguageChange} />
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
          <LandingPage
            onStartOnboarding={handleStartOnboarding}
            onOpenLogin={() => setAuthModal('login')}
            isLoggedIn={!!token}
          />
        </>
      )}

      {view === 'onboarding_A' && (
        <OnboardingPathA
          onOnboardSuccess={handleOnboardSuccess}
          onCancel={() => setView('landing')}
        />
      )}

      {view === 'onboarding_B' && (
        <OnboardingPathB
          onOnboardSuccess={handleOnboardSuccess}
          onCancel={() => setView('landing')}
        />
      )}

      {view === 'dashboard' && activeProfile && (
        <Dashboard
          token={token}
          activeProfile={activeProfile}
          onLogout={handleLogout}
          onProfileUpdate={setActiveProfile}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLanguageChange={handleLanguageChange}
        />
      )}

      {/* --- AUTH GATE MODAL OVERLAYS --- */}
      {authModal && (
        <div
          className="auth-overlay animate-fade-in"
          id="auth_overlay_modal"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setAuthModal(null); }}
        >
          <div className="auth-card glass-card glass-card-glow text-left" role="dialog" aria-modal="true" aria-labelledby="auth_modal_title">
            <div className="auth-header flex-between mb-20">
              <h3 id="auth_modal_title">{authModal === 'register' ? t('auth.createAccountTitle', 'Create Your Account') : t('auth.welcomeBack', 'Welcome Back')}</h3>
              <button className="btn-close" onClick={() => setAuthModal(null)} id="btn_close_auth" aria-label={t('common.close', 'Close')}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {authError && <div className="auth-error-box mb-20" role="alert">{authError}</div>}

            <form onSubmit={handleAuthSubmit}>
              {authModal === 'register' && (
                <div className="form-group">
                  <label className="form-label" htmlFor="inp_reg_name">{t('auth.fullName', 'Full Name')}</label>
                  <input
                    type="text"
                    id="inp_reg_name"
                    className="input-field"
                    placeholder={t('auth.fullNamePlaceholder', 'e.g. Alisher Usmanov')}
                    value={authForm.fullName}
                    onChange={(e) => setAuthForm(p => ({ ...p, fullName: e.target.value }))}
                    autoFocus={authModal === 'register'}
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
                  value={authForm.email}
                  onChange={(e) => setAuthForm(p => ({ ...p, email: e.target.value }))}
                  autoFocus={authModal === 'login'}
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
                  value={authForm.password}
                  onChange={(e) => setAuthForm(p => ({ ...p, password: e.target.value }))}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary w-full btn-lg mt-10" id="btn_auth_submit" disabled={authLoading}>
                {authLoading
                  ? (<><i className="fa-solid fa-spinner fa-spin"></i> {t('common.pleaseWait', 'Please wait...')}</>)
                  : (authModal === 'register' ? t('auth.registerCta', 'Register Account') : t('auth.login', 'Sign In'))}
              </button>
            </form>

            <div className="auth-toggle-link mt-20 text-center">
              {authModal === 'register' ? (
                <p>{t('auth.alreadyHaveAccount', 'Already have an account?')} <span onClick={() => setAuthModal('login')} className="link-text">{t('auth.login', 'Sign In')}</span></p>
              ) : (
                <p>{t('auth.newToMarkivo', 'New to Markivo?')} <span onClick={() => setAuthModal('register')} className="link-text">{t('auth.register', 'Create Account')}</span></p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
