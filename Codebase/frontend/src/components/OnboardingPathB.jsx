import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import './Onboarding.css';

// Signup asks only what is needed to build a working dashboard: who you are,
// and where you post. Brand tone, slogan and logo used to live here as two more
// steps; they are now asked from the profile panel's "!" badge, alongside the
// business-specific questions Gemini writes (backend/profileQuestions.js).
// Registering fast matters more than registering completely.
export default function OnboardingPathB({ onOnboardSuccess }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1); // 1: Info, 2: Channels, 3: Action Logs
  const [formData, setFormData] = useState({
    businessName: '',
    category: 'Cafe / Coffee Shop',
    description: '',
    location: '',
    isOnline: false,
    audience: ''
  });

  // Channels to create
  const [channels, setChannels] = useState({
    googleBusiness: true,
    // DISABLED: SEO/Meta temporarily off — see 2026-08-13
    // instagram: true,
    telegram: true,
    // Removed TikTok and WhatsApp per MVP scope (Section 12)
    // tiktok: true,
    // whatsapp: false
  });

  // Action logs state
  const [currentLogIndex, setCurrentLogIndex] = useState(-1);
  const [completedLogs, setCompletedLogs] = useState([]);

  // Generate action logs based on selected channels
  const generateActionLogs = () => {
    const logs = [
      { text: t('onboarding.pipeline.logBrand', 'Generating brand identity visual package...'), icon: 'fa-palette' },
      { text: t('onboarding.pipeline.logQuestions', 'Preparing follow-up questions about your business...'), icon: 'fa-clipboard-question' }
    ];

    if (channels.googleBusiness) {
      logs.push({ text: t('onboarding.pipeline.logGoogle', 'Configuring Google Business Profile endpoints...'), icon: 'fa-map-location-dot' });
    }

    // DISABLED: SEO/Meta temporarily off — see 2026-08-13
    // if (channels.instagram) {
    //   logs.push({ text: t('onboarding.pipeline.logInstagram', 'Scaffolding Instagram Business profile structure...'), icon: 'fa-instagram' });
    // }

    if (channels.telegram) {
      logs.push({ text: t('onboarding.pipeline.logTelegram', 'Establishing secure Telegram channel webhook bot...'), icon: 'fa-paper-plane' });
    }

    logs.push(
      // DISABLED: SEO/Meta temporarily off — see 2026-08-13
      // { text: t('onboarding.pipeline.logSeo', 'Compiling SEO semantic metadata and Tashkent keyword tags...'), icon: 'fa-tags' },
      { text: t('onboarding.pipeline.logCalendar', 'Scheduling inaugural calendar AI post drafts...'), icon: 'fa-calendar-days' }
    );

    return logs;
  };

  const actionLogs = generateActionLogs();

  const handleInputChange = (field, val) => {
    setFormData(prev => ({ ...prev, [field]: val }));
  };

  const handleNextStep = () => {
    if (step === 1 && !formData.businessName) return;
    setStep(prev => prev + 1);
  };

  const handlePrevStep = () => {
    setStep(prev => prev - 1);
  };

  const startActionPipeline = () => {
    setStep(3);
    setCurrentLogIndex(0);
    setCompletedLogs([]);

    // ~2s end to end. Long enough to read as work happening, short enough that
    // nobody sits watching a progress bar before they have seen the product.
    const executeLog = (index) => {
      if (index >= actionLogs.length) {
        setTimeout(() => {
          triggerCompleteOnboard();
        }, 400);
        return;
      }

      setTimeout(() => {
        setCompletedLogs(prev => [...prev, index]);
        setCurrentLogIndex(index + 1);
        executeLog(index + 1);
      }, 200);
    };

    executeLog(0);
  };

  const triggerCompleteOnboard = async () => {
    // No logo and no tone yet — both are asked later, and construct must not be
    // handed a placeholder that would then read as the owner's own choice.
    const finalProfile = {
      ...formData,
      onboardPath: 'B (Scratch)',
      platforms: channels
    };

    try {
      const data = await api.post('/api/onboarding/construct', finalProfile);
      onOnboardSuccess(data.profile);
    } catch {
      // Offline/failed construct: proceed with the locally-built profile.
      onOnboardSuccess({ ...finalProfile, platforms: channels });
    }
  };

  return (
    <div className="onboarding-card glass-card animate-fade-in" id="onboarding_path_b_container">
      {/* HEADER */}
      <div className="onboarding-header">
        {step < 3 && (
          <button className="btn-back" onClick={handlePrevStep} disabled={step === 1} id="btn_back_onboard_b">
            <i className="fa-solid fa-arrow-left"></i> {t('onboarding.pathB.prevStep', 'Previous Step')}
          </button>
        )}
        <div className="onboarding-badge">{t('onboarding.pathB.badge', 'Path B: Build From Scratch')}</div>
      </div>

      {/* STEPPERS */}
      {step < 3 && (
        <div className="stepper-dots">
          <div className={`stepper-dot ${step >= 1 ? 'active' : ''}`}>1</div>
          <div className="stepper-line"></div>
          <div className={`stepper-dot ${step >= 2 ? 'active' : ''}`}>2</div>
        </div>
      )}

      {/* STEP 1: GENERAL INFORMATION */}
      {step === 1 && (
        <div className="step-content animate-fade-in">
          <h2>{t('onboarding.pathB.step1Title', "Let's Discover Your Business Vibe")}</h2>
          <p className="subtitle">{t('onboarding.pathB.step1Subtitle', 'Tell us about your project, and we will build its entire visual and social infrastructure.')}</p>

          <div className="form-group">
            <label className="form-label" htmlFor="inp_name_b">{t('onboarding.businessName', 'Business Name')}</label>
            <input
              type="text"
              id="inp_name_b"
              className="input-field"
              placeholder={t('onboarding.pathB.namePlaceholder', 'e.g. Noir Cafe & Workspace')}
              value={formData.businessName}
              onChange={(e) => handleInputChange('businessName', e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="sel_category">{t('onboarding.businessCategory', 'Business Category')}</label>
            <select
              id="sel_category"
              className="select-field"
              value={formData.category}
              onChange={(e) => handleInputChange('category', e.target.value)}
            >
              <option value="Cafe / Coffee Shop">{t('onboarding.categories.cafe', 'Cafe / Coffee Shop')}</option>
              <option value="Beauty Salon / Spa">{t('onboarding.categories.beauty', 'Beauty Salon / Spa')}</option>
              <option value="Co-working & Study Space">{t('onboarding.categories.coworking', 'Co-working & Study Space')}</option>
              <option value="Retail Boutique / Fashion">{t('onboarding.categories.retail', 'Retail Boutique / Fashion')}</option>
              <option value="Local Restaurant / Food">{t('onboarding.categories.restaurant', 'Local Restaurant / Food')}</option>
              <option value="Professional Tech Agency">{t('onboarding.categories.tech', 'Professional Tech Agency')}</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="inp_desc_b">{t('onboarding.pathB.descriptionLabel', 'Describe your business in 2-3 sentences')}</label>
            <textarea
              id="inp_desc_b"
              className="input-field text-area"
              rows="3"
              placeholder={t('onboarding.pathB.descriptionPlaceholder', 'What makes your brand unique? e.g. A warm coffee shop in Tashkent serving third-wave espresso, offering high-speed WiFi booths for programmers and students, and fresh handmade Uzbek honey cakes.')}
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
            ></textarea>
          </div>

          <div className="form-group">
            <div className="flex-between">
              <label className="form-label" htmlFor="inp_loc_b">{t('onboarding.pathB.addressLabel', 'Physical Address')}</label>
              <label className="checkbox-label-toggle">
                <input
                  type="checkbox"
                  checked={formData.isOnline}
                  onChange={(e) => handleInputChange('isOnline', e.target.checked)}
                />
                {t('onboarding.onlineToggle', 'We operate online / remotely')}
              </label>
            </div>
            {!formData.isOnline && (
              <input
                type="text"
                id="inp_loc_b"
                className="input-field"
                placeholder={t('onboarding.pathB.addressPlaceholder', 'e.g. Amir Temur Avenue, Tashkent')}
                value={formData.location}
                onChange={(e) => handleInputChange('location', e.target.value)}
              />
            )}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="inp_audience">{t('onboarding.pathB.audienceLabel', 'Who is your ideal customer?')}</label>
            <input
              type="text"
              id="inp_audience"
              className="input-field"
              placeholder={t('onboarding.pathB.audiencePlaceholder', 'e.g. Young programmers, designers, coffee enthusiasts, and remote workers')}
              value={formData.audience}
              onChange={(e) => handleInputChange('audience', e.target.value)}
            />
          </div>

          <button className="btn btn-primary w-full btn-lg" onClick={handleNextStep} disabled={!formData.businessName} id="btn_onboard_b_step1">
            {t('onboarding.pathB.step1CtaChannels', 'Select Social Channels')} <i className="fa-solid fa-arrow-right"></i>
          </button>
        </div>
      )}

      {/* STEP 2: CHANNELS SELECTION */}
      {step === 2 && (
        <div className="step-content animate-fade-in">
          <h2>{t('onboarding.pathB.step4Title', 'Select Channels to Initialize')}</h2>
          <p className="subtitle">{t('onboarding.pathB.step4Subtitle', 'Choose which accounts to scaffold automatically. Markivo creates draft structures verified for Central Asia.')}</p>

          <div className="results-grid">
            {/* GOOGLE BUSINESS */}
            <div className={`result-item glass-card ${channels.googleBusiness ? 'active' : ''}`} onClick={() => setChannels(p => ({ ...p, googleBusiness: !p.googleBusiness }))} id="btn_select_google">
              <div className="result-status">
                <span className="platform-icon google"><i className="fa-brands fa-google"></i></span>
                <div>
                  <h4>{t('onboarding.channels.googleTitle', 'Google Business Profile')}</h4>
                  <p>{t('onboarding.channels.googleOauth', 'Connect via OAuth to manage your Business Profile')}</p>
                </div>
              </div>
              <div className="checkbox-wrap">
                <i className={`fa-solid ${channels.googleBusiness ? 'fa-square-check checked-icon' : 'fa-square unchecked-icon'}`}></i>
              </div>
            </div>

            {/* DISABLED: SEO/Meta temporarily off — see 2026-08-13
                The Instagram channel card is hidden until Meta review completes. */}

            {/* TELEGRAM */}
            <div className={`result-item glass-card ${channels.telegram ? 'active' : ''}`} onClick={() => setChannels(p => ({ ...p, telegram: !p.telegram }))} id="btn_select_telegram">
              <div className="result-status">
                <span className="platform-icon telegram"><i className="fa-brands fa-telegram"></i></span>
                <div>
                  <h4>{t('onboarding.channels.telegramTitle', 'Telegram Business Channel')}</h4>
                  <p>{t('onboarding.channels.telegramOauth', 'Connect via OAuth to manage your Telegram channel')}</p>
                </div>
              </div>
              <div className="checkbox-wrap">
                <i className={`fa-solid ${channels.telegram ? 'fa-square-check checked-icon' : 'fa-square unchecked-icon'}`}></i>
              </div>
            </div>
          </div>

          <p className="text-muted text-center mt-10">
            <i className="fa-solid fa-circle-info"></i>{' '}
            {t('onboarding.pathB.deferredNote', 'Your tone, slogan and logo come next — we will ask from your profile once you are inside.')}
          </p>

          <div className="action-buttons-wrap">
            <button className="btn btn-secondary" onClick={handlePrevStep} id="btn_step4_back">{t('common.back', 'Back')}</button>
            <button className="btn btn-accent btn-lg" onClick={startActionPipeline} id="btn_start_pipeline">
              {t('onboarding.pathB.scaffoldCta', 'Scaffold My Business')} <i className="fa-solid fa-rocket animate-pulse"></i>
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: PIPELINE EXECUTION */}
      {step === 3 && (
        <div className="step-content text-center py-40">
          <h2>{t('onboarding.pipeline.title', 'Constructing Your Digital Infrastructure')}</h2>
          <p className="subtitle">{t('onboarding.pipeline.subtitle', "Please wait while Markivo's AI engine creates and registers your digital profiles.")}</p>

          <div className="pipeline-console glass-card text-left">
            <div className="console-header">
              <span className="console-dot dot-red"></span>
              <span className="console-dot dot-yellow"></span>
              <span className="console-dot dot-green"></span>
              <span className="console-title">markivo-builder@service:~$ execute</span>
            </div>
            <div className="console-body">
              {actionLogs.map((log, index) => {
                const isCompleted = completedLogs.includes(index);
                const isCurrent = currentLogIndex === index;
                const isPending = currentLogIndex < index;

                return (
                  <div key={index} className={`console-line ${isCompleted ? 'line-done' : ''} ${isCurrent ? 'line-current' : ''} ${isPending ? 'line-pending' : ''}`}>
                    {isCompleted && <span className="line-symbol text-success"><i className="fa-solid fa-check-double"></i> {t('onboarding.pipeline.statusSuccess', 'SUCCESS')}</span>}
                    {isCurrent && <span className="line-symbol text-accent animate-pulse"><i className="fa-solid fa-spinner fa-spin"></i> {t('onboarding.pipeline.statusRunning', 'RUNNING')}</span>}
                    {isPending && <span className="line-symbol text-muted"><i className="fa-regular fa-clock"></i> {t('onboarding.pipeline.statusPending', 'PENDING')}</span>}
                    <span className="line-text"><i className={`fa-solid ${log.icon} ml-10`}></i> {log.text}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="progress-bar-outer mt-30">
            <div className="progress-bar-inner" style={{ width: `${Math.min(100, Math.floor((completedLogs.length / actionLogs.length) * 100))}%` }}></div>
          </div>
        </div>
      )}
    </div>
  );
}
