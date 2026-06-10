import { useState } from 'react';
import api from '../lib/api';
import './Onboarding.css';

const Stars = ({ rating }) => (
  <span className="star-row" title={`${rating} / 5`}>
    {Array.from({ length: 5 }).map((_, i) => (
      <i key={i} className={`fa-${i < Math.round(rating || 0) ? 'solid' : 'regular'} fa-star`}></i>
    ))}
  </span>
);

export default function OnboardingPathA({ onOnboardSuccess, onCancel }) {
  const [businessName, setBusinessName] = useState('');
  const [location, setLocation] = useState('Tashkent');
  const [step, setStep] = useState(1); // 1: Search Form, 2: Scanning, 3: Verify Results
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState('Initiating global scan...');
  const [scanResults, setScanResults] = useState(null);
  const [scanError, setScanError] = useState(null);

  // Checked statuses for platforms to connect
  const [connections, setConnections] = useState({
    googleBusiness: true,
    instagram: true,
    telegram: true,
    // Removed TikTok per MVP scope (Section 12)
  });

  const handleSearchSubmit = async (e) => {
    e.preventDefault();
    if (!businessName.trim()) return;

    setScanError(null);
    setScanResults(null);
    setStep(2);
    setScanProgress(10);

    // Dynamic scanning sequence animation
    const progressIntervals = [
      { progress: 25, label: 'Scanning Google Maps...' },
      { progress: 45, label: 'Discovering social media accounts (@Handles)...' },
      { progress: 70, label: 'Checking reviews & nearby competitors...' },
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
      // Pre-select only what the scan actually found — honesty over optimism.
      setConnections({
        googleBusiness: !!data.googleBusiness?.found,
        instagram: !!data.instagram?.found,
        telegram: !!data.telegram?.found,
      });
      setStep(3);
    } catch (err) {
      // A real outage must show an error, never fabricated results.
      console.error('Scan API failed:', err);
      setScanError(err.data?.error || err.message || 'The discovery scan failed. Please try again.');
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
    const g = scanResults?.googleBusiness;
    const finalProfile = {
      businessName,
      location,
      onboardPath: 'A (Discovery)',
      category: g?.category || 'Cafe / Local Shop',
      description: `A discovered business located in ${location}.`,
      platforms: connections,
      logo: {
        text: `☕ ${businessName}`,
        color: '#D4A373',
        bgColor: '#131016',
        shape: 'rounded'
      },
      ...(g?.found && g.placeId
        ? { google: { placeId: g.placeId, rating: g.rating, reviewsCount: g.reviewsCount } }
        : {}),
      ...(scanResults?.competitors?.length ? { competitors: scanResults.competitors } : {}),
    };

    try {
      const data = await api.post('/api/onboarding/construct', finalProfile);
      onOnboardSuccess(data.profile);
    } catch (err) {
      console.error('Failed to submit onboard, proceeding locally:', err);
      onOnboardSuccess({ ...finalProfile, platforms: connections });
    }
  };

  const g = scanResults?.googleBusiness;

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

      {/* STEP 3a: SCAN FAILED */}
      {step === 3 && scanError && (
        <div className="step-content animate-fade-in">
          <div className="scan-error-banner" id="scan_error_banner">
            <i className="fa-solid fa-triangle-exclamation"></i>
            <div>
              <h4>The scan could not be completed</h4>
              <p>{scanError}</p>
            </div>
          </div>
          <div className="action-buttons-wrap">
            <button className="btn btn-primary" onClick={() => { setScanError(null); setStep(1); }} id="btn_retry_scan">
              <i className="fa-solid fa-arrow-rotate-left"></i> Try Again
            </button>
          </div>
        </div>
      )}

      {/* STEP 3b: RESULTS VERIFY GRID */}
      {step === 3 && !scanError && scanResults && (
        <div className="step-content animate-fade-in">
          <h2>{g?.found ? 'We Found Your Business!' : 'Scan Results'}</h2>
          <p className="subtitle">
            Toggle which platforms you'd like to sync into the Markivo central dashboard. We'll populate your dashboard with active data in Uzbek, Russian, and English.
          </p>

          <div className="results-grid">
            {/* GOOGLE BUSINESS */}
            {g?.found ? (
              <div className={`result-item glass-card ${connections.googleBusiness ? 'active' : ''}`} onClick={() => handleConnectionToggle('googleBusiness')} id="btn_verify_google">
                <div className="result-status">
                  <span className="platform-icon google"><i className="fa-brands fa-google"></i></span>
                  <div>
                    <h4>
                      {g.name}
                      {g.verified && <span className="verified-badge" title="Listed as operational on Google"><i className="fa-solid fa-circle-check"></i> On Google</span>}
                    </h4>
                    {g.rating != null && (
                      <p className="result-meta">
                        <Stars rating={g.rating} /> {g.rating} · {g.reviewsCount} reviews
                      </p>
                    )}
                    {g.address && <p className="result-meta">{g.address}</p>}
                    {g.mapsUrl && (
                      <a href={g.mapsUrl} target="_blank" rel="noreferrer" className="link-text" onClick={(e) => e.stopPropagation()}>
                        View on Google Maps <i className="fa-solid fa-arrow-up-right-from-square"></i>
                      </a>
                    )}
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
            ) : (
              <div className="result-item glass-card disabled" id="card_google_notfound">
                <div className="result-status">
                  <span className="platform-icon google"><i className="fa-brands fa-google"></i></span>
                  <div>
                    <h4>Not found on Google Maps</h4>
                    <p>We couldn't find "{businessName}" in {location}. Check the spelling and location, or create a Google Business Profile — Markivo will guide you later.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Alternatives — informational only */}
            {g?.alternatives?.length > 0 && (
              <div className="alt-matches" id="alt_matches_list">
                <p className="result-meta">Not your business? We also found:</p>
                {g.alternatives.map((a) => (
                  <p key={a.placeId} className="result-meta">
                    · {a.name}{a.address ? ` — ${a.address}` : ''}{a.rating != null ? ` (★ ${a.rating})` : ''}
                  </p>
                ))}
              </div>
            )}

            {/* INSTAGRAM */}
            {scanResults.instagram?.found ? (
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
            ) : (
              <div className="result-item glass-card disabled" id="card_instagram_notfound">
                <div className="result-status">
                  <span className="platform-icon instagram"><i className="fa-brands fa-instagram"></i></span>
                  <div>
                    <h4>Instagram not detected</h4>
                    <p>No public account found automatically — you can connect it later from the dashboard.</p>
                  </div>
                </div>
              </div>
            )}

            {/* TELEGRAM */}
            {scanResults.telegram?.found ? (
              <div className={`result-item glass-card ${connections.telegram ? 'active' : ''}`} onClick={() => handleConnectionToggle('telegram')} id="btn_verify_telegram">
                <div className="result-status">
                  <span className="platform-icon telegram"><i className="fa-brands fa-telegram"></i></span>
                  <div>
                    <h4>Telegram Business Channel</h4>
                    <p>Sync your channel into the Markivo dashboard</p>
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
            ) : (
              <div className="result-item glass-card disabled" id="card_telegram_soon">
                <div className="result-status">
                  <span className="platform-icon telegram"><i className="fa-brands fa-telegram"></i></span>
                  <div>
                    <h4>Telegram <span className="coming-soon-pill">Coming soon</span></h4>
                    <p>Channel management and AI publishing for Telegram arrive right after the MVP.</p>
                  </div>
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
              {g?.found
                ? `"${g.name}" is live on Google Maps${g.rating != null ? ` with a ${g.rating}★ rating across ${g.reviewsCount} reviews` : ''}${scanResults.competitors?.length ? `, and we spotted ${scanResults.competitors.length} similar ${scanResults.competitors.length === 1 ? 'business' : 'businesses'} competing nearby` : ''}. Connecting your channels lets the Markivo agent track competitors, strengthen your local SEO, and draft content tuned to your audience.`
                : `We couldn't confirm a Google Maps listing yet — that's the single highest-impact channel for local discovery. Markivo will help you establish your presence and start tracking competitors from day one.`}
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
