import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import LandingPage from './components/LandingPage';
import OnboardingPathA from './components/OnboardingPathA';
import OnboardingPathB from './components/OnboardingPathB';
import Dashboard from './components/Dashboard';
import LanguageSelector from './components/LanguageSelector';
import ThemeToggle from './components/ThemeToggle';
import AuthCard from './components/AuthCard';
import api from './lib/api';
import { ROUTING_ENABLED, currentSection, goToSection } from './lib/subdomains';
import './App.css';
import './i18n/i18n';

const qp = () => new URLSearchParams(window.location.search);

// Initial view. When subdomain routing is on, the section is dictated by the
// current subdomain; otherwise everything starts on the landing view.
function initialView() {
  if (!ROUTING_ENABLED) return 'landing';
  const section = currentSection();
  if (section === 'onboarding') return qp().get('path') === 'A' ? 'onboarding_A' : 'onboarding_B';
  if (section === 'login') return 'login';
  return section; // 'landing' | 'dashboard'
}

// On the login subdomain, ?mode selects the form; elsewhere register is the
// default (opened from a "Get started" CTA).
function initialAuthMode() {
  if (ROUTING_ENABLED && currentSection() === 'login') {
    return qp().get('mode') === 'register' ? 'register' : 'login';
  }
  return 'register';
}

export default function App() {
  const { t } = useTranslation();
  const [view, setView] = useState(initialView); // 'landing' | 'login' | 'onboarding_A' | 'onboarding_B' | 'dashboard'
  const [activeProfile, setActiveProfile] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('markivo_theme') || 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('markivo_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  // Auth state
  const [token, setToken] = useState(api.tokens.access() || null);
  const [authModalOpen, setAuthModalOpen] = useState(false); // single-origin modal visibility
  const [authMode, setAuthMode] = useState(initialAuthMode); // 'login' | 'register'
  const [authForm, setAuthForm] = useState({ email: '', password: '', fullName: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  // Onboarding path targeted after auth (carried across subdomains via ?path).
  const [authPathTarget, setAuthPathTarget] = useState(() => (ROUTING_ENABLED ? qp().get('path') || 'B' : 'B'));
  // Set right before a login/register so the session effect routes us afterwards.
  const postAuthRef = useRef(false);
  // True when the dashboard-subdomain profile load failed offline (show a retry).
  const [dashLoadFailed, setDashLoadFailed] = useState(false);

  // Navigate to a section. Crosses subdomains when routing is on (with a session
  // hand-off); otherwise drives the equivalent in-app view/state.
  const go = (section, params = {}) => {
    if (goToSection(section, params)) return; // redirected to another subdomain
    switch (section) {
      case 'login':
        if (params.path) setAuthPathTarget(params.path);
        setAuthMode(params.mode === 'register' ? 'register' : 'login');
        setAuthModalOpen(true);
        break;
      case 'onboarding':
        setAuthModalOpen(false);
        setView(params.path === 'A' ? 'onboarding_A' : 'onboarding_B');
        break;
      case 'dashboard':
        setAuthModalOpen(false);
        setView('dashboard');
        break;
      default:
        setAuthModalOpen(false);
        setView('landing');
    }
  };

  const handleLogout = () => {
    api.logout();        // async server revocation (reads the refresh token synchronously)
    api.tokens.clear();  // clear the local session NOW so the subdomain hand-off carries nothing
    setToken(null);
    setActiveProfile(null);
    go('landing');
  };

  // Persist the language choice on the account when signed in (best-effort).
  const handleLanguageChange = (lng) => {
    if (api.tokens.access()) {
      api.put('/api/me', { preferredLang: lng }).catch(() => {});
    }
  };

  // Validate the stored session and route accordingly. Handles three cases:
  // (1) just authenticated -> go to dashboard/onboarding; (2) direct page load
  // on a protected subdomain -> guard/redirect; (3) single-origin state restore.
  useEffect(() => {
    if (!token) {
      // Arriving on an authed-only subdomain without a session -> send to login.
      // Routing is on here, so this is always a cross-origin redirect (no setState).
      if (ROUTING_ENABLED) {
        const section = currentSection();
        if (section === 'dashboard' || section === 'onboarding') {
          goToSection('login', { mode: 'register', path: qp().get('path') || 'B' });
        }
      }
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        await api.get('/api/auth/me'); // validates the token (refreshes if needed)
        const profileData = await api.get('/api/onboarding/active');
        if (cancelled) return;
        const onboarded = !!(profileData && profileData.onboarded);
        if (onboarded) setActiveProfile(profileData);

        // Fresh login/register: route to the right next step.
        if (postAuthRef.current) {
          postAuthRef.current = false;
          if (onboarded) go('dashboard');
          else go('onboarding', { path: authPathTarget === 'A' ? 'A' : 'B' });
          return;
        }

        // Page load / token restore.
        if (ROUTING_ENABLED) {
          const section = currentSection();
          if (onboarded && (section === 'login' || section === 'onboarding')) go('dashboard');
          else if (!onboarded && section === 'dashboard') go('onboarding', { path: 'B' });
          else if (!onboarded && section === 'login') go('onboarding', { path: authPathTarget === 'A' ? 'A' : 'B' });
          return;
        }

        // Single-origin: never stomp an onboarding flow the user just entered.
        if (onboarded) setView('dashboard');
        else setView((v) => (v === 'onboarding_A' || v === 'onboarding_B' ? v : 'landing'));
      } catch (err) {
        if (cancelled) return;
        // Network offline: keep the current view; offline fallbacks handle the UX.
        // On the dashboard subdomain there is no prior view to fall back to, so
        // flag it and offer a retry instead of an unrecoverable spinner.
        if (err.isNetwork) {
          if (ROUTING_ENABLED && currentSection() === 'dashboard' && !activeProfile) setDashLoadFailed(true);
          return;
        }
        // Otherwise the session is invalid/expired and refresh failed — sign out.
        handleLogout();
      }
    })();
    return () => { cancelled = true; };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close the single-origin auth modal on Escape for keyboard accessibility.
  useEffect(() => {
    if (!authModalOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setAuthModalOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authModalOpen]);

  // Landing CTAs. `path` is 'A' | 'B' | 'dashboard' (the last means "go straight
  // to the dashboard" for a returning, onboarded user).
  const handleStartOnboarding = (path) => {
    const targetPath = path === 'dashboard' ? 'B' : path;
    setAuthPathTarget(targetPath);
    if (!token) return go('login', { mode: 'register', path: targetPath });
    if (activeProfile) return go('dashboard');
    return go('onboarding', { path: targetPath });
  };

  const openLogin = () => go('login', { mode: 'login' });

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      const data = authMode === 'register'
        ? await api.register(authForm)
        : await api.login({ email: authForm.email, password: authForm.password });

      postAuthRef.current = true; // let the session effect route us next
      setAuthModalOpen(false);
      setAuthForm({ email: '', password: '', fullName: '' });
      setToken(data.accessToken || data.token); // triggers the session effect
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
    go('dashboard');
  };

  const patchAuthForm = (patch) => setAuthForm((p) => ({ ...p, ...patch }));

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
            onOpenLogin={openLogin}
            isLoggedIn={!!token}
          />
        </>
      )}

      {/* Dedicated auth page — login.markivo.io */}
      {view === 'login' && (
        <>
          <div className="floating-controls">
            <LanguageSelector onChange={handleLanguageChange} />
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
          <div className="auth-page" id="auth_page">
            <AuthCard
              mode={authMode}
              error={authError}
              form={authForm}
              onChange={patchAuthForm}
              loading={authLoading}
              onSubmit={handleAuthSubmit}
              onSwitchMode={setAuthMode}
            />
          </div>
        </>
      )}

      {view === 'onboarding_A' && (
        <OnboardingPathA
          onOnboardSuccess={handleOnboardSuccess}
          onCancel={() => go('landing')}
        />
      )}

      {view === 'onboarding_B' && (
        <OnboardingPathB
          onOnboardSuccess={handleOnboardSuccess}
          onCancel={() => go('landing')}
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

      {/* Dashboard subdomain reached before the profile has loaded/validated. */}
      {view === 'dashboard' && !activeProfile && (
        <div className="app-loading" id="app_loading">
          {dashLoadFailed ? (
            <>
              <i className="fa-solid fa-triangle-exclamation"></i>
              <span>{t('auth.networkError', 'Could not reach the server. Please ensure the backend is running.')}</span>
              <button className="btn btn-primary btn-sm" id="btn_dashboard_retry" onClick={() => { setDashLoadFailed(false); window.location.reload(); }}>
                {t('common.retry', 'Retry')}
              </button>
            </>
          ) : (
            <>
              <i className="fa-solid fa-spinner fa-spin"></i>
              <span>{t('common.loading', 'Loading…')}</span>
            </>
          )}
        </div>
      )}

      {/* --- SINGLE-ORIGIN AUTH GATE MODAL OVERLAY --- */}
      {authModalOpen && (
        <div
          className="auth-overlay animate-fade-in"
          id="auth_overlay_modal"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setAuthModalOpen(false); }}
        >
          <AuthCard
            mode={authMode}
            error={authError}
            form={authForm}
            onChange={patchAuthForm}
            loading={authLoading}
            onSubmit={handleAuthSubmit}
            onSwitchMode={setAuthMode}
            onClose={() => setAuthModalOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
