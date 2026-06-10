import { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import OnboardingPathA from './components/OnboardingPathA';
import OnboardingPathB from './components/OnboardingPathB';
import Dashboard from './components/Dashboard';
import LanguageSelector from './components/LanguageSelector';
import api from './lib/api';
import './App.css';
import './i18n/i18n';

export default function App() {
  const [view, setView] = useState('landing'); // 'landing' | 'onboarding_A' | 'onboarding_B' | 'dashboard'
  const [activeProfile, setActiveProfile] = useState(null);
  
  // Auth state
  const [token, setToken] = useState(api.tokens.access() || null);
  const [authModal, setAuthModal] = useState(null); // null | 'login' | 'register'
  const [authForm, setAuthForm] = useState({ email: '', password: '', fullName: '' });
  const [authError, setAuthError] = useState('');
  const [authPathTarget, setAuthPathTarget] = useState('B'); // Onboarding Path targeted after login

  const handleLogout = () => {
    api.logout();
    setToken(null);
    setActiveProfile(null);
    setView('landing');
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
        if (err.isNetwork) {
          console.warn('Backend server offline. Proceeding in offline sandbox environment.');
        } else {
          // Session invalid/expired and refresh failed — sign out cleanly.
          handleLogout();
        }
      }
    }
    verifySession();
  }, [token]);

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
          ? 'Could not reach the server. Please ensure the backend is running.'
          : (err.message || 'Authentication failed')
      );
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
          <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 50 }}><LanguageSelector /></div>
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
        />
      )}

      {/* --- AUTH GATE MODAL OVERLAYS --- */}
      {authModal && (
        <div className="auth-overlay animate-fade-in" id="auth_overlay_modal">
          <div className="auth-card glass-card glass-card-glow text-left">
            <div className="auth-header flex-between mb-20">
              <h3>{authModal === 'register' ? 'Create Your Account' : 'Welcome Back'}</h3>
              <button className="btn-close" onClick={() => setAuthModal(null)} id="btn_close_auth">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {authError && <div className="auth-error-box mb-20">{authError}</div>}

            <form onSubmit={handleAuthSubmit}>
              {authModal === 'register' && (
                <div className="form-group">
                  <label className="form-label" htmlFor="inp_reg_name">Full Name</label>
                  <input
                    type="text"
                    id="inp_reg_name"
                    className="input-field"
                    placeholder="e.g. Alisher Usmanov"
                    value={authForm.fullName}
                    onChange={(e) => setAuthForm(p => ({ ...p, fullName: e.target.value }))}
                    required
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="inp_auth_email">Email Address</label>
                <input
                  type="email"
                  id="inp_auth_email"
                  className="input-field"
                  placeholder="name@business.com"
                  value={authForm.email}
                  onChange={(e) => setAuthForm(p => ({ ...p, email: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="inp_auth_pass">Password</label>
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

              <button type="submit" className="btn btn-primary w-full btn-lg mt-10" id="btn_auth_submit">
                {authModal === 'register' ? 'Register Account' : 'Sign In'}
              </button>
            </form>

            <div className="auth-toggle-link mt-20 text-center">
              {authModal === 'register' ? (
                <p>Already have an account? <span onClick={() => setAuthModal('login')} className="link-text">Sign In</span></p>
              ) : (
                <p>New to Markivo? <span onClick={() => setAuthModal('register')} className="link-text">Create Account</span></p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
