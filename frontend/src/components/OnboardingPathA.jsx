import { useState } from 'react';
import api from '../lib/api';
import './Onboarding.css';

export default function OnboardingPathA({ onOnboardSuccess, onCancel }) {
  const [businessName, setBusinessName] = useState('');
  const [location, setLocation] = useState('Tashkent');
  const [step, setStep] = useState(1); // 1: Search Form, 2: Scanning, 3: Verify Results
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState('Initiating global scan...');
  const [scanResults, setScanResults] = useState(null);

  // Checked statuses for platforms to connect
  const [connections, setConnections] = useState({
    googleBusiness: true,
    instagram: true,
    telegram: true,
    // Removed TikTok per MVP scope (Section 12)
    // tiktok: false
  });

  const handleSearchSubmit = async (e) => {
    e.preventDefault();
    if (!businessName.trim()) return;

    setStep(2);
    setScanProgress(10);

    // Dynamic scanning sequence animation
    const progressIntervals = [
      { progress: 25, label: 'Scanning Google Maps and Yandex indexes...' },
      { progress: 45, label: 'Discovering social media accounts (@Handles)...' },
      { progress: 70, label: 'Checking reviews, local directories & 2GIS...' },
      { progress: 90, label: 'Checking AI visibility in ChatGPT / Perplexity...' },
      { progress: 100, label: 'Scan complete! Compiling results...' }
    ];

    progressIntervals.forEach((item, index) => {
      setTimeout(() => {
        setScanProgress(item.progress);
        setScanStatus(item.label);

        if (item.progress === 100) {
          triggerFetchScan();
        }
      }, (index + 1) * 800);
    });
  };

  const triggerFetchScan = async () => {
    try {
      const data = await api.post('/api/discovery/scan', { businessName, location });
      setScanResults(data);
      setStep(3);
    } catch (err) {
      console.error('Scan API failed, falling back to mock results:', err);
      // Fallback
      setScanResults({
        googleBusiness: { found: true, name: `${businessName} on Google Maps`, rating: 4.8, reviewsCount: 14, address: `${location}, Uzbekistan`, verified: true },
        instagram: { found: true, handle: `@${businessName.toLowerCase().replace(/ /g, '')}_uz`, followers: 1050, postsCount: 23 },
        telegram: { found: true, channel: `@${businessName.toLowerCase().replace(/ /g, '')}`, subscribers: 720 },
        tiktok: { found: false, suggestedHandle: `@${businessName.toLowerCase().replace(/ /g, '')}.co` },
        yandexMaps: { found: true, rating: 4.5, reviewsCount: 10 },
        aiSearchPresence: { chatgptMentioned: true, perplexityMentioned: false, mentionsSummary: "Found in local cafes catalog." }
      });
      setStep(3);
    }
  };

  const handleConnectionToggle = (platform) => {
    setConnections(prev => ({
      ...prev,
      [platform]: !prev[platform]
    }));
  };

  const handleConfirmOnboard = async () => {
    const finalProfile = {
      businessName,
      location,
      onboardPath: 'A (Discovery)',
      category: 'Cafe / Local Shop',
      description: `A discovered business located in ${location}.`,
      platforms: connections,
      logo: {
        text: `☕ ${businessName}`,
        color: '#D4A373',
        bgColor: '#131016',
        shape: 'rounded'
      }
    };

    try {
      const data = await api.post('/api/onboarding/construct', finalProfile);
      onOnboardSuccess(data.profile);
    } catch (err) {
      console.error('Failed to submit onboard, proceeding locally:', err);
      onOnboardSuccess({ ...finalProfile, platforms: connections });
    }
  };

  return (
    <div className="onboarding-card glass-card animate-fade-in" id="onboarding_path_a_container">
      {/* HEADER */}
      <div className="onboarding-header">
        <button className="btn-back" onClick={onCancel} id="btn_back_onboard_a">
          <i className="fa-solid fa-arrow-left"></i> Back to Home
        </button>
        <div className="onboarding-badge">PATH A: DISCOVERY MODE</div>
      </div>

      {/* STEP 1: SEARCH FORM */}
      {step === 1 && (
        <div className="step-content">
          <h2>Scan Your Existing Marketing Channels</h2>
          <p className="subtitle">
            Enter your business name and location, and our AI scanner will search the web to aggregate your reviews, social channels, and search presence.
          </p>

          <form onSubmit={handleSearchSubmit} className="search-form">
            <div className="form-group">
              <label className="form-label" htmlFor="inp_business_name">Business Name</label>
              <input
                type="text"
                id="inp_business_name"
                className="input-field"
                placeholder="e.g. Noir Coffee & Workspace"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="inp_location">City / Location</label>
              <input
                type="text"
                id="inp_location"
                className="input-field"
                placeholder="e.g. Tashkent"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary w-full btn-lg" id="btn_start_scan">
              Scan My Digital Presence <i className="fa-solid fa-satellite-dish"></i>
            </button>
          </form>
        </div>
      )}

      {/* STEP 2: SCANNING PROGRESS */}
      {step === 2 && (
        <div className="step-content text-center py-40">
          <div className="scan-radar-container">
            <div className="scan-radar">
              <div className="radar-circle circle-1"></div>
              <div className="radar-circle circle-2"></div>
              <i className="fa-solid fa-magnifying-glass-chart radar-icon animate-pulse"></i>
            </div>
          </div>
          <h2>Scanning Digital Footprint</h2>
          <p className="status-label">{scanStatus}</p>
          <div className="progress-bar-outer">
            <div className="progress-bar-inner" style={{ width: `${scanProgress}%` }}></div>
          </div>
          <span className="progress-percentage">{scanProgress}% completed</span>
        </div>
      )}

      {/* STEP 3: RESULTS VERIFY GRID */}
      {step === 3 && scanResults && (
        <div className="step-content animate-fade-in">
          <h2>We Found Your Marketing Channels!</h2>
          <p className="subtitle">
            Toggle which platforms you'd like to sync into the Markivo central dashboard. We'll populate your dashboard with active data in Uzbek, Russian, and English.
          </p>

          <div className="results-grid">
            {/* GOOGLE BUSINESS */}
            {scanResults.googleBusiness.found && (
              <div className={`result-item glass-card ${connections.googleBusiness ? 'active' : ''}`} onClick={() => handleConnectionToggle('googleBusiness')} id="btn_verify_google">
                <div className="result-status">
                  <span className="platform-icon google"><i className="fa-brands fa-google"></i></span>
                  <div>
                    <h4>Google Maps Profile</h4>
                    <p>Connect via OAuth to manage your Business Profile</p>
                  </div>
                </div>
                <div className="checkbox-wrap">
                  {connections.googleBusiness ? (
                    <i className="fa-solid fa-circle-check checked-icon"></i>
                  ) : (
                    <i className="fa-regular fa-circle unchecked-icon"></i>
                  )}
                </div>
              </div>
            )}

            {/* INSTAGRAM */}
            {scanResults.instagram.found && (
              <div className={`result-item glass-card ${connections.instagram ? 'active' : ''}`} onClick={() => handleConnectionToggle('instagram')} id="btn_verify_instagram">
                <div className="result-status">
                  <span className="platform-icon instagram"><i className="fa-brands fa-instagram"></i></span>
                  <div>
                    <h4>Instagram Handle</h4>
                    <p>Connect via OAuth to manage your Instagram account</p>
                  </div>
                </div>
                <div className="checkbox-wrap">
                  {connections.instagram ? (
                    <i className="fa-solid fa-circle-check checked-icon"></i>
                  ) : (
                    <i className="fa-regular fa-circle unchecked-icon"></i>
                  )}
                </div>
              </div>
            )}

            {/* TELEGRAM */}
            {scanResults.telegram.found && (
              <div className={`result-item glass-card ${connections.telegram ? 'active' : ''}`} onClick={() => handleConnectionToggle('telegram')} id="btn_verify_telegram">
                <div className="result-status">
                  <span className="platform-icon telegram"><i className="fa-brands fa-telegram"></i></span>
                  <div>
                    <h4>Telegram Business Channel</h4>
                    <p>Connect via OAuth to manage your Telegram channel</p>
                  </div>
                </div>
                <div className="checkbox-wrap">
                  {connections.telegram ? (
                    <i className="fa-solid fa-circle-check checked-icon"></i>
                  ) : (
                    <i className="fa-regular fa-circle unchecked-icon"></i>
                  )}
                </div>
              </div>
            )}

          </div>

          {/* AI SUMMARY BOX */}
          <div className="ai-summary-card glass-card">
            <div className="ai-summary-title">
              <i className="fa-solid fa-wand-magic-sparkles text-accent"></i>
              <h4>AI Local Discovery Scan Insight</h4>
            </div>
            <p className="ai-summary-text">
              "Your brand has a solid local base with highly rated reviews on Google and Yandex Maps. However, your keyword density is low and you are missing from TikTok. Connecting these platforms will allow our AI Agent to launch cross-posting and enhance your ranking."
            </p>
          </div>

          <div className="action-buttons-wrap">
            <button className="btn btn-secondary" onClick={() => setStep(1)} id="btn_rescan">
              <i className="fa-solid fa-arrow-rotate-left"></i> Rescan
            </button>
            <button className="btn btn-primary" onClick={handleConfirmOnboard} id="btn_confirm_onboard_a">
              Connect Channels & Enter Dashboard <i className="fa-solid fa-chart-pie"></i>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
