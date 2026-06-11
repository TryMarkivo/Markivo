import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import './Onboarding.css';

// Normalize a social handle/channel for display ("noir.coffee" -> "@noir.coffee").
const atHandle = (h) => (h && !h.startsWith('@') ? `@${h}` : h);

const Stars = ({ rating }) => {
  const { t } = useTranslation();
  return (
    <span className="star-row" title={t('onboarding.scan.starsTitle', { defaultValue: '{{rating}} / 5', rating })}>
      {Array.from({ length: 5 }).map((_, i) => (
        <i key={i} className={`fa-${i < Math.round(rating || 0) ? 'solid' : 'regular'} fa-star`}></i>
      ))}
    </span>
  );
};

export default function OnboardingPathA({ onOnboardSuccess, onCancel }) {
  const { t } = useTranslation();
  const [businessName, setBusinessName] = useState('');
  const [location, setLocation] = useState('Tashkent');
  const [step, setStep] = useState(1); // 1: Search Form, 2: Scanning, 3: Verify Results
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState(t('onboarding.scan.statusInit', 'Initiating global scan...'));
  const [scanResults, setScanResults] = useState(null);
  const [scanError, setScanError] = useState(null);
  // Index of the alternative slot whose competitor refresh is in flight (null = idle).
  const [altSwapIndex, setAltSwapIndex] = useState(null);

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
      { progress: 25, label: t('onboarding.scan.statusMaps', 'Scanning Google Maps...') },
      { progress: 45, label: t('onboarding.scan.statusSocial', 'Discovering social media accounts (@Handles)...') },
      { progress: 70, label: t('onboarding.scan.statusReviews', 'Checking reviews & nearby competitors...') },
      { progress: 90, label: t('onboarding.scan.statusAi', 'Checking AI visibility in ChatGPT / Perplexity...') },
      { progress: 100, label: t('onboarding.scan.statusComplete', 'Scan complete! Compiling results...') }
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
        // A comingSoon telegram detection is informational only — the integration is still gated.
        telegram: !!data.telegram?.found && !data.telegram?.comingSoon,
      });
      setStep(3);
    } catch (err) {
      // A real outage must show an error, never fabricated results.
      console.error('Scan API failed:', err);
      setScanError(err.data?.error || err.message || t('onboarding.scan.errorFallback', 'The discovery scan failed. Please try again.'));
      setStep(3);
    }
  };

  const handleConnectionToggle = (platform) => {
    setConnections(prev => ({
      ...prev,
      [platform]: !prev[platform]
    }));
  };

  // User picked an alternative match: swap it with the current top pick (lossless —
  // alternatives carry full business objects), then refresh nearby competitors for it.
  const handleAlternativeSelect = async (alt, index) => {
    if (altSwapIndex !== null) return; // a competitor refresh is already in flight
    const current = scanResults?.googleBusiness;
    if (!current || !alt) return;

    // Previous top pick takes the clicked alternative's slot.
    const prevTop = { ...current };
    delete prevTop.found;
    delete prevTop.alternatives;
    const nextAlternatives = (current.alternatives || []).map((item, i) => (i === index ? prevTop : item));
    setScanResults((prev) => ({
      ...prev,
      googleBusiness: { ...alt, found: true, alternatives: nextAlternatives },
    }));

    // Only refetch competitors when we know enough about the new pick.
    if (alt.location?.lat == null || alt.location?.lng == null || !alt.primaryType) return;
    setAltSwapIndex(index);
    try {
      const data = await api.post('/api/discovery/competitors', {
        lat: alt.location.lat,
        lng: alt.location.lng,
        primaryType: alt.primaryType,
        excludePlaceId: alt.placeId,
      });
      if (Array.isArray(data?.competitors)) {
        setScanResults((prev) => ({ ...prev, competitors: data.competitors }));
      }
    } catch (err) {
      // Non-fatal: keep the previous competitor list rather than blanking the insight.
      console.warn('Competitor refresh failed:', err);
    } finally {
      setAltSwapIndex(null);
    }
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
          <i className="fa-solid fa-arrow-left"></i> {t('onboarding.pathA.back', 'Back to Home')}
        </button>
        <div className="onboarding-badge">{t('onboarding.pathA.badge', 'Path A: Discovery Mode')}</div>
      </div>

      {/* STEP 1: SEARCH FORM */}
      {step === 1 && (
        <div className="step-content">
          <h2>{t('onboarding.pathA.title', 'Scan Your Existing Marketing Channels')}</h2>
          <p className="subtitle">
            {t('onboarding.pathA.subtitle', 'Enter your business name and location, and our AI scanner will search the web to aggregate your reviews, social channels, and search presence.')}
          </p>

          <form onSubmit={handleSearchSubmit} className="search-form">
            <div className="form-group">
              <label className="form-label" htmlFor="inp_business_name">{t('onboarding.businessName', 'Business Name')}</label>
              <input
                type="text"
                id="inp_business_name"
                className="input-field"
                placeholder={t('onboarding.pathA.namePlaceholder', 'e.g. Noir Coffee & Workspace')}
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="inp_location">{t('onboarding.pathA.locationLabel', 'City / Location')}</label>
              <input
                type="text"
                id="inp_location"
                className="input-field"
                placeholder={t('onboarding.pathA.locationPlaceholder', 'e.g. Tashkent')}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary w-full btn-lg" id="btn_start_scan">
              {t('onboarding.pathA.scanCta', 'Scan My Digital Presence')} <i className="fa-solid fa-satellite-dish"></i>
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
          <h2>{t('onboarding.scan.title', 'Scanning Digital Footprint')}</h2>
          <p className="status-label">{scanStatus}</p>
          <div className="progress-bar-outer">
            <div className="progress-bar-inner" style={{ width: `${scanProgress}%` }}></div>
          </div>
          <span className="progress-percentage">{t('onboarding.scan.progress', { defaultValue: '{{percent}}% completed', percent: scanProgress })}</span>
        </div>
      )}

      {/* STEP 3a: SCAN FAILED */}
      {step === 3 && scanError && (
        <div className="step-content animate-fade-in">
          <div className="scan-error-banner" id="scan_error_banner">
            <i className="fa-solid fa-triangle-exclamation"></i>
            <div>
              <h4>{t('onboarding.scan.errorTitle', 'The scan could not be completed')}</h4>
              <p>{scanError}</p>
            </div>
          </div>
          <div className="action-buttons-wrap">
            <button className="btn btn-primary" onClick={() => { setScanError(null); setStep(1); }} id="btn_retry_scan">
              <i className="fa-solid fa-arrow-rotate-left"></i> {t('common.tryAgain', 'Try Again')}
            </button>
          </div>
        </div>
      )}

      {/* STEP 3b: RESULTS VERIFY GRID */}
      {step === 3 && !scanError && scanResults && (
        <div className="step-content animate-fade-in">
          <h2>{g?.found ? t('onboarding.results.foundTitle', 'We Found Your Business!') : t('onboarding.results.title', 'Scan Results')}</h2>
          <p className="subtitle">
            {t('onboarding.results.subtitle', "Toggle which platforms you'd like to sync into the Markivo central dashboard. We'll populate your dashboard with active data in Uzbek, Russian, and English.")}
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
                      {g.verified && <span className="verified-badge" title={t('onboarding.results.googleVerifiedTitle', 'Listed as operational on Google')}><i className="fa-solid fa-circle-check"></i> {t('onboarding.results.onGoogle', 'On Google')}</span>}
                    </h4>
                    {g.rating != null && (
                      <p className="result-meta">
                        <Stars rating={g.rating} /> {t('onboarding.results.ratingReviews', { defaultValue_one: '{{rating}} · {{count}} review', defaultValue_other: '{{rating}} · {{count}} reviews', rating: g.rating, count: g.reviewsCount })}
                      </p>
                    )}
                    {g.address && <p className="result-meta">{g.address}</p>}
                    {g.mapsUrl && (
                      <a href={g.mapsUrl} target="_blank" rel="noreferrer" className="link-text" onClick={(e) => e.stopPropagation()}>
                        {t('onboarding.results.viewOnMaps', 'View on Google Maps')} <i className="fa-solid fa-arrow-up-right-from-square"></i>
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
                    <h4>{t('onboarding.results.googleNotFoundTitle', 'Not found on Google Maps')}</h4>
                    <p>{t('onboarding.results.googleNotFoundText', { defaultValue: 'We couldn\'t find "{{businessName}}" in {{location}}. Check the spelling and location, or create a Google Business Profile — Markivo will guide you later.', businessName, location })}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Alternatives — click to make one of these the top pick */}
            {g?.alternatives?.length > 0 && (
              <div className="alt-matches" id="alt_matches_list">
                <p className="result-meta">{t('onboarding.results.alternativesIntro', 'Not your business? We also found:')}</p>
                {g.alternatives.map((a, index) => (
                  <div
                    key={a.placeId}
                    id={`btn_alt_${index}`}
                    className="result-item glass-card"
                    style={{ padding: '12px 16px', marginTop: 8 }}
                    role="button"
                    tabIndex={0}
                    title={t('onboarding.results.altSelectTitle', 'Use this business instead')}
                    onClick={() => handleAlternativeSelect(a, index)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleAlternativeSelect(a, index);
                      }
                    }}
                  >
                    <div className="result-status">
                      <div>
                        <h4>{a.name}</h4>
                        {a.address && <p className="result-meta">{a.address}</p>}
                        {a.rating != null && (
                          <p className="result-meta">
                            <Stars rating={a.rating} /> {t('onboarding.results.ratingReviews', { defaultValue_one: '{{rating}} · {{count}} review', defaultValue_other: '{{rating}} · {{count}} reviews', rating: a.rating, count: a.reviewsCount })}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="checkbox-wrap">
                      {altSwapIndex === index ? (
                        <i className="fa-solid fa-spinner fa-spin unchecked-icon" aria-hidden="true"></i>
                      ) : (
                        <i className="fa-solid fa-right-left unchecked-icon" aria-hidden="true"></i>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* INSTAGRAM */}
            {scanResults.instagram?.found ? (
              <div className={`result-item glass-card ${connections.instagram ? 'active' : ''}`} onClick={() => handleConnectionToggle('instagram')} id="btn_verify_instagram">
                <div className="result-status">
                  <span className="platform-icon instagram"><i className="fa-brands fa-instagram"></i></span>
                  <div>
                    <h4>
                      {scanResults.instagram.source === 'website' && scanResults.instagram.handle
                        ? atHandle(scanResults.instagram.handle)
                        : t('onboarding.results.instagramTitle', 'Instagram Handle')}
                    </h4>
                    <p>{t('onboarding.channels.instagramOauth', 'Connect via OAuth to manage your Instagram account')}</p>
                    {scanResults.instagram.source === 'website' && (
                      <p className="result-meta">
                        <i className="fa-solid fa-link"></i> {t('onboarding.results.foundViaWebsite', 'Detected from your website')}
                      </p>
                    )}
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
                    <h4>{t('onboarding.results.instagramNotFoundTitle', 'Instagram not detected')}</h4>
                    <p>{t('onboarding.results.instagramNotFoundText', 'No public account found automatically — you can connect it later from the dashboard.')}</p>
                  </div>
                </div>
              </div>
            )}

            {/* TELEGRAM */}
            {scanResults.telegram?.found && scanResults.telegram?.comingSoon ? (
              // Channel detected, but the integration is still gated — informational, not toggleable.
              <div className="result-item glass-card disabled" id="card_telegram_soon">
                <div className="result-status">
                  <span className="platform-icon telegram"><i className="fa-brands fa-telegram"></i></span>
                  <div>
                    <h4>
                      {scanResults.telegram.channel ? atHandle(scanResults.telegram.channel) : 'Telegram'}
                      <span className="coming-soon-pill">{t('common.comingSoon', 'Coming soon')}</span>
                    </h4>
                    {scanResults.telegram.source === 'website' && (
                      <p className="result-meta">
                        <i className="fa-solid fa-link"></i> {t('onboarding.results.foundViaWebsite', 'Detected from your website')}
                      </p>
                    )}
                    <p>{t('onboarding.results.telegramSoonText', 'Channel management and AI publishing for Telegram arrive right after the MVP.')}</p>
                  </div>
                </div>
              </div>
            ) : scanResults.telegram?.found ? (
              <div className={`result-item glass-card ${connections.telegram ? 'active' : ''}`} onClick={() => handleConnectionToggle('telegram')} id="btn_verify_telegram">
                <div className="result-status">
                  <span className="platform-icon telegram"><i className="fa-brands fa-telegram"></i></span>
                  <div>
                    <h4>{t('onboarding.channels.telegramTitle', 'Telegram Business Channel')}</h4>
                    <p>{t('onboarding.results.telegramSyncText', 'Sync your channel into the Markivo dashboard')}</p>
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
                    <h4>Telegram <span className="coming-soon-pill">{t('common.comingSoon', 'Coming soon')}</span></h4>
                    <p>{t('onboarding.results.telegramSoonText', 'Channel management and AI publishing for Telegram arrive right after the MVP.')}</p>
                  </div>
                </div>
              </div>
            )}

          </div>

          {/* AI SUMMARY BOX */}
          <div className="ai-summary-card glass-card">
            <div className="ai-summary-title">
              <i className="fa-solid fa-wand-magic-sparkles text-accent"></i>
              <h4>{t('onboarding.results.insightTitle', 'AI Local Discovery Scan Insight')}</h4>
            </div>
            <p className="ai-summary-text">
              {g?.found
                ? t('onboarding.results.insightFoundBase', { defaultValue: '"{{name}}" is live on Google Maps', name: g.name })
                  + (g.rating != null ? t('onboarding.results.insightFoundRating', { defaultValue: ' with a {{rating}}★ rating across {{count}} reviews', rating: g.rating, count: g.reviewsCount }) : '')
                  + (scanResults.competitors?.length ? t('onboarding.results.insightFoundCompetitors', { defaultValue_one: ', and we spotted {{count}} similar business competing nearby', defaultValue_other: ', and we spotted {{count}} similar businesses competing nearby', count: scanResults.competitors.length }) : '')
                  + t('onboarding.results.insightFoundTail', '. Connecting your channels lets the Markivo agent track competitors, strengthen your local SEO, and draft content tuned to your audience.')
                : t('onboarding.results.insightNotFound', "We couldn't confirm a Google Maps listing yet — that's the single highest-impact channel for local discovery. Markivo will help you establish your presence and start tracking competitors from day one.")}
            </p>
          </div>

          <div className="action-buttons-wrap">
            <button className="btn btn-secondary" onClick={() => setStep(1)} id="btn_rescan">
              <i className="fa-solid fa-arrow-rotate-left"></i> {t('onboarding.rescan', 'Rescan')}
            </button>
            <button className="btn btn-primary" onClick={handleConfirmOnboard} id="btn_confirm_onboard_a">
              {t('onboarding.results.confirmCta', 'Connect Channels & Enter Dashboard')} <i className="fa-solid fa-chart-pie"></i>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
