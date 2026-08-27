import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import './Onboarding.css';

const TONE_KEYS = {
  'Cozy & Warm': 'cozy',
  'Modern & Minimalist': 'modern',
  'Energetic & Fast-paced': 'energetic',
  'Professional & Trustworthy': 'professional',
  'Playful & Fun': 'playful',
  'Luxury & Premium': 'luxury'
};

export default function OnboardingPathB({ onOnboardSuccess }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1); // 1: Info, 2: Tone & Slogans, 3: Logo, 4: Channels, 5: Action Logs
  const [formData, setFormData] = useState({
    businessName: '',
    category: 'Cafe / Coffee Shop',
    description: '',
    location: '',
    isOnline: false,
    audience: '',
    tone: 'Cozy & Warm',
    slogan: '',
    logoText: ''
  });

  // `shape` is fixed at 'circle' — the emblem shape is no longer a user-facing
  // option. It stays in the object because it is persisted in logoMetadata and
  // read back by the dashboard's logo renderer.
  const [logoStyle, setLogoStyle] = useState({
    color: '#D4A373',
    bgColor: '#1A1816',
    shape: 'circle',
    icon: '☕'
  });

  const [generatedSlogans, setGeneratedSlogans] = useState([]);
  const [generatingSlogans, setGeneratingSlogans] = useState(false);

  // AI logo generation (step 3)
  const [logoVariants, setLogoVariants] = useState([]);
  const [generatingLogos, setGeneratingLogos] = useState(false);
  const [logoGenError, setLogoGenError] = useState('');
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(null);

  // Brand-asset ownership — does the user already have a slogan / logo of their
  // own? null = not answered yet, 'yes' = provide their own, 'no' = create with AI.
  const [hasSlogan, setHasSlogan] = useState(null);
  const [hasLogo, setHasLogo] = useState(null);
  const [logoUploadError, setLogoUploadError] = useState('');

  const [channels, setChannels] = useState({
    googleBusiness: true,
    instagram: true,
    telegram: true,
  });

  // Action logs state
  const [currentLogIndex, setCurrentLogIndex] = useState(-1);
  const [completedLogs, setCompletedLogs] = useState([]);

  // Generate action logs based on selected channels
  const generateActionLogs = () => {
    const logs = [
      { text: t('onboarding.pipeline.logBrand', 'Generating brand identity visual package...'), icon: 'fa-palette' },
      { text: t('onboarding.pipeline.logLogo', 'Saving high-res SVG & PNG logo layouts...'), icon: 'fa-file-image' }
    ];

    if (channels.googleBusiness) {
      logs.push({ text: t('onboarding.pipeline.logGoogle', 'Configuring Google Business Profile endpoints...'), icon: 'fa-map-location-dot' });
    }

    if (channels.instagram) {
      logs.push({ text: t('onboarding.pipeline.logInstagram', 'Scaffolding Instagram Business profile structure...'), icon: 'fa-instagram' });
    }

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

  const handleGenerateSlogans = async () => {
    if (!formData.description) return;
    setGeneratingSlogans(true);
    try {
      const data = await api.post('/api/onboarding/slogans', {
        category: formData.category,
        description: formData.description,
        tone: formData.tone,
      });
      setGeneratedSlogans(data.slogans);
    } catch {
      // Offline fallback: localized slogans for the chosen tone so uz/ru users
      // never see English. The backend normally returns these live.
      const toneKey = TONE_KEYS[formData.tone] || 'cozy';
      const localized = t(`onboarding.fallbackSlogans.${toneKey}`, { returnObjects: true });
      setGeneratedSlogans(Array.isArray(localized) ? localized : []);
    }
    setGeneratingSlogans(false);
  };

  const handleGenerateLogos = async () => {
    setGeneratingLogos(true);
    setLogoGenError('');
    try {
      const data = await api.post('/api/onboarding/logos', {
        businessName: formData.businessName,
        category: formData.category,
        tone: formData.tone,
      });
      setLogoVariants(data.logos || data.variants || []);
      setSelectedVariantIdx(null);
    } catch (err) {
      setLogoGenError(err.message);
    }
    setGeneratingLogos(false);
  };

  const handleSelectLogoVariant = (variant, idx) => {
    setSelectedVariantIdx(idx);
    setLogoStyle(p => ({
      ...p,
      svg: variant.svg,
      color: variant.palette.accent,
      bgColor: variant.palette.bg
    }));
  };

  // Record whether the user already owns a logo. Clearing the unused asset keeps
  // the final profile in sync with their choice (no stale AI svg / upload leaks).
  const chooseHasLogo = (val) => {
    setHasLogo(val);
    setLogoUploadError('');
    if (val === 'yes') {
      setSelectedVariantIdx(null);
      setLogoStyle(p => ({ ...p, svg: undefined }));
    } else {
      setLogoStyle(p => ({ ...p, image: undefined }));
    }
  };

  // The whole profile (logo data URL included) is POSTed to /api/onboarding/construct,
  // which is behind a 1MB JSON body parser. Base64 inflates bytes ~33%, so we cap the
  // ENCODED data URL — not the raw file — at a budget that leaves room for the rest of
  // the JSON body. Oversized uploads are rejected up front instead of silently failing
  // the construct call (which would drop the whole onboarding on reload).
  const MAX_LOGO_DATAURL = 700 * 1024; // ~700KB encoded

  // Read an uploaded logo into a compact data URL. Raster images are downscaled
  // (re-scaling smaller if still too large); SVGs are kept as-is when small enough
  // (rendered inside an <img>, so scripts in the SVG cannot run).
  const handleLogoUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file after an error
    if (!file) return;
    setLogoUploadError('');

    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!allowed.includes(file.type)) {
      setLogoUploadError(t('onboarding.pathB.uploadTypeError', 'Please upload a PNG, JPG, SVG, or WebP image.'));
      return;
    }
    if (file.size > 1024 * 1024) {
      setLogoUploadError(t('onboarding.pathB.uploadSizeError', 'Image must be under 1MB.'));
      return;
    }

    const tooBig = () => setLogoUploadError(t('onboarding.pathB.uploadSizeError', 'Image must be under 1MB.'));

    const reader = new FileReader();
    reader.onload = () => {
      // SVG: keep the vector as-is only if the encoded string fits the budget.
      if (file.type === 'image/svg+xml') {
        if ((reader.result || '').length > MAX_LOGO_DATAURL) return tooBig();
        setLogoStyle(p => ({ ...p, image: reader.result, svg: undefined }));
        setSelectedVariantIdx(null);
        return;
      }
      // Raster: downscale, shrinking further if the PNG data URL is still too large.
      const img = new Image();
      img.onload = () => {
        for (const maxDim of [512, 384, 256, 160]) {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const url = canvas.toDataURL('image/png');
          if (url.length <= MAX_LOGO_DATAURL) {
            setLogoStyle(p => ({ ...p, image: url, svg: undefined }));
            setSelectedVariantIdx(null);
            return;
          }
        }
        tooBig();
      };
      img.onerror = () => setLogoUploadError(t('onboarding.pathB.uploadTypeError', 'Please upload a PNG, JPG, SVG, or WebP image.'));
      img.src = reader.result;
    };
    reader.onerror = () => setLogoUploadError(t('onboarding.pathB.uploadTypeError', 'Please upload a PNG, JPG, SVG, or WebP image.'));
    reader.readAsDataURL(file);
  };

  // Emblem shape is no longer a user-facing choice — every logo is a circle, so
  // the presets only vary colour and icon.
  const triggerLogoPreset = (tone) => {
    const presets = {
      'Cozy & Warm': { color: '#D4A373', bgColor: '#1E1B18', shape: 'circle', icon: '☕' },
      'Modern & Minimalist': { color: '#ffffff', bgColor: '#0f0f10', shape: 'circle', icon: '✦' },
      'Energetic & Fast-paced': { color: '#FF7F11', bgColor: '#0B0D1B', shape: 'circle', icon: '⚡' },
      'Professional & Trustworthy': { color: '#3A86F0', bgColor: '#0E1726', shape: 'circle', icon: '🛡️' },
      'Playful & Fun': { color: '#FF007F', bgColor: '#1A0E23', shape: 'circle', icon: '🎈' },
      'Luxury & Premium': { color: '#E5C158', bgColor: '#0D0D0D', shape: 'circle', icon: '👑' }
    };
    const sel = presets[tone] || presets['Cozy & Warm'];
    // Preserve a user-uploaded logo across tone changes; the AI svg is
    // tone-specific and is intentionally reset — clear the variant highlight too
    // so a now-dropped AI logo doesn't stay visually selected.
    setLogoStyle(prev => ({ ...sel, image: prev.image }));
    setSelectedVariantIdx(null);
  };

  const handleToneChange = (tone) => {
    handleInputChange('tone', tone);
    triggerLogoPreset(tone);
  };

  const handleNextStep = () => {
    if (step === 1 && !formData.businessName) return;
    if (step === 2 && !formData.slogan) {
      // Pick first generated slogan as default if none selected
      if (generatedSlogans.length > 0) {
        handleInputChange('slogan', generatedSlogans[0]);
      }
    }
    setStep(prev => prev + 1);
  };

  const handlePrevStep = () => {
    setStep(prev => prev - 1);
  };

  const startActionPipeline = () => {
    setStep(5);
    setCurrentLogIndex(0);
    setCompletedLogs([]);

    const executeLog = (index) => {
      if (index >= actionLogs.length) {
        // Complete onboarding
        setTimeout(() => {
          triggerCompleteOnboard();
        }, 1000);
        return;
      }

      setTimeout(() => {
        setCompletedLogs(prev => [...prev, index]);
        setCurrentLogIndex(index + 1);
        executeLog(index + 1);
      }, 900);
    };

    executeLog(0);
  };

  const triggerCompleteOnboard = async () => {
    const finalProfile = {
      ...formData,
      onboardPath: 'B (Scratch)',
      platforms: channels,
      logo: {
        ...logoStyle, // carries color, bgColor, shape, icon — and svg when an AI variant was picked
        text: formData.logoText || formData.businessName
      }
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
        {step < 5 && (
          <button className="btn-back" onClick={handlePrevStep} disabled={step === 1} id="btn_back_onboard_b">
            <i className="fa-solid fa-arrow-left"></i> {t('onboarding.pathB.prevStep', 'Previous Step')}
          </button>
        )}
        <div className="onboarding-badge">{t('onboarding.pathB.badge', 'Path B: Build From Scratch')}</div>
      </div>

      {/* STEPPERS */}
      {step < 5 && (
        <div className="stepper-dots">
          <div className={`stepper-dot ${step >= 1 ? 'active' : ''}`}>1</div>
          <div className="stepper-line"></div>
          <div className={`stepper-dot ${step >= 2 ? 'active' : ''}`}>2</div>
          <div className="stepper-line"></div>
          <div className={`stepper-dot ${step >= 3 ? 'active' : ''}`}>3</div>
          <div className="stepper-line"></div>
          <div className={`stepper-dot ${step >= 4 ? 'active' : ''}`}>4</div>
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
              onChange={(e) => {
                handleInputChange('businessName', e.target.value);
                if (!formData.logoText) handleInputChange('logoText', e.target.value);
              }}
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
            {t('onboarding.pathB.step1Cta', 'Choose Brand Tone & Slogan')} <i className="fa-solid fa-arrow-right"></i>
          </button>
        </div>
      )}

      {/* STEP 2: TONE & SLOGANS */}
      {step === 2 && (
        <div className="step-content animate-fade-in">
          <h2>{t('onboarding.pathB.step2Title', 'Define Your Brand Identity')}</h2>
          <p className="subtitle">{t('onboarding.pathB.step2Subtitle', 'Pick a tone that aligns with your space, then add your slogan — your own or AI-generated.')}</p>

          <div className="form-group">
            <label className="form-label">{t('onboarding.brandTone', 'Brand Tone')}</label>
            <div className="grid-3 tone-grid">
              {['Cozy & Warm', 'Modern & Minimalist', 'Energetic & Fast-paced', 'Professional & Trustworthy', 'Playful & Fun', 'Luxury & Premium'].map((tone) => (
                <div
                  key={tone}
                  className={`tone-card glass-card ${formData.tone === tone ? 'active' : ''}`}
                  onClick={() => handleToneChange(tone)}
                >
                  <span className="tone-bullet"></span>
                  {t(`onboarding.tones.${TONE_KEYS[tone]}`, tone)}
                </div>
              ))}
            </div>
          </div>

          <div className="form-group border-top-onboard pt-20">
            <label className="form-label">{t('onboarding.pathB.sloganQuestion', 'Do you already have a brand slogan?')}</label>
            <div className="brand-choice-grid grid-2 mb-10">
              <button
                type="button"
                className={`choice-card glass-card ${hasSlogan === 'yes' ? 'active' : ''}`}
                onClick={() => setHasSlogan('yes')}
                id="btn_has_slogan_yes"
              >
                <i className="fa-solid fa-circle-check choice-icon"></i>
                <span className="choice-title">{t('onboarding.pathB.hasSloganYes', 'I already have a slogan')}</span>
                <span className="choice-hint">{t('onboarding.pathB.hasSloganYesHint', 'Enter your existing tagline')}</span>
              </button>
              <button
                type="button"
                className={`choice-card glass-card ${hasSlogan === 'no' ? 'active' : ''}`}
                onClick={() => setHasSlogan('no')}
                id="btn_has_slogan_no"
              >
                <i className="fa-solid fa-wand-magic-sparkles choice-icon"></i>
                <span className="choice-title">{t('onboarding.pathB.hasSloganNo', 'Create one with AI')}</span>
                <span className="choice-hint">{t('onboarding.pathB.hasSloganNoHint', 'Generate 3 on-brand slogans')}</span>
              </button>
            </div>

            {hasSlogan === 'yes' && (
              <input
                type="text"
                className="input-field"
                id="inp_own_slogan"
                placeholder={t('onboarding.pathB.ownSloganPlaceholder', 'Enter your brand slogan')}
                value={formData.slogan}
                onChange={(e) => handleInputChange('slogan', e.target.value)}
              />
            )}

            {hasSlogan === 'no' && (
              <>
                <div className="flex-between align-center mb-10">
                  <label className="form-label">{t('onboarding.pathB.sloganLabel', 'Custom Brand Slogan')}</label>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleGenerateSlogans}
                    disabled={generatingSlogans || !formData.description}
                    id="btn_generate_slogans"
                  >
                    {generatingSlogans ? t('common.generating', 'Generating...') : t('onboarding.pathB.generateSlogans', 'Generate 3 AI Slogans ✦')}
                  </button>
                </div>

                {generatedSlogans.length > 0 ? (
                  <div className="slogans-list">
                    {generatedSlogans.map((slogan, idx) => (
                      <div
                        key={idx}
                        className={`slogan-item glass-card ${formData.slogan === slogan ? 'active' : ''}`}
                        onClick={() => handleInputChange('slogan', slogan)}
                      >
                        <p>"{slogan}"</p>
                        {formData.slogan === slogan && <i className="fa-solid fa-check slogan-selected"></i>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    className="input-field"
                    placeholder={t('onboarding.pathB.sloganPlaceholder', "Write your own slogan, or describe your cafe above and click 'Generate'")}
                    value={formData.slogan}
                    onChange={(e) => handleInputChange('slogan', e.target.value)}
                  />
                )}
              </>
            )}
          </div>

          <div className="action-buttons-wrap">
            <button className="btn btn-secondary" onClick={handlePrevStep} id="btn_step2_back">{t('common.back', 'Back')}</button>
            <button className="btn btn-primary" onClick={handleNextStep} id="btn_step2_next" disabled={hasSlogan === null}>
              {t('onboarding.pathB.step2Cta', 'Continue to Logo')} <i className="fa-solid fa-arrow-right"></i>
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: LOGO — OWN OR AI */}
      {step === 3 && (
        <div className="step-content animate-fade-in">
          <h2>{t('onboarding.pathB.step3Title', 'Set Up Your Logo')}</h2>
          <p className="subtitle">{t('onboarding.pathB.step3Subtitle', 'Use your own logo, or let our engine design one tailored to your brand.')}</p>

          <label className="form-label">{t('onboarding.pathB.logoQuestion', 'Do you already have a logo?')}</label>
          <div className="brand-choice-grid grid-2 mb-20">
            <button
              type="button"
              className={`choice-card glass-card ${hasLogo === 'yes' ? 'active' : ''}`}
              onClick={() => chooseHasLogo('yes')}
              id="btn_has_logo_yes"
            >
              <i className="fa-solid fa-circle-check choice-icon"></i>
              <span className="choice-title">{t('onboarding.pathB.hasLogoYes', 'I already have a logo')}</span>
              <span className="choice-hint">{t('onboarding.pathB.hasLogoYesHint', 'Upload your existing logo')}</span>
            </button>
            <button
              type="button"
              className={`choice-card glass-card ${hasLogo === 'no' ? 'active' : ''}`}
              onClick={() => chooseHasLogo('no')}
              id="btn_has_logo_no"
            >
              <i className="fa-solid fa-wand-magic-sparkles choice-icon"></i>
              <span className="choice-title">{t('onboarding.pathB.hasLogoNo', 'Create one with AI')}</span>
              <span className="choice-hint">{t('onboarding.pathB.hasLogoNoHint', 'Design a logo from your brand')}</span>
            </button>
          </div>

          {/* OWN LOGO: UPLOAD */}
          {hasLogo === 'yes' && (
            <div className="grid-2 logo-designer-grid">
              <div className="logo-controls">
                <div className="form-group">
                  <label className="form-label">{t('onboarding.pathB.uploadLabel', 'Upload your logo')}</label>
                  <label className="logo-upload-dropzone" htmlFor="inp_logo_upload">
                    <i className="fa-solid fa-cloud-arrow-up"></i>
                    <span>{t('onboarding.pathB.uploadCta', 'Choose an image · PNG, JPG, SVG (max 1MB)')}</span>
                  </label>
                  <input
                    type="file"
                    id="inp_logo_upload"
                    className="visually-hidden-file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={handleLogoUpload}
                  />
                  {logoUploadError && <p className="logo-gen-error">{logoUploadError}</p>}
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="inp_logo_text_own">{t('onboarding.logoText', 'Logo Text')}</label>
                  <input
                    type="text"
                    id="inp_logo_text_own"
                    className="input-field"
                    value={formData.logoText}
                    onChange={(e) => handleInputChange('logoText', e.target.value)}
                  />
                </div>
              </div>

              <div className="logo-preview-card glass-card text-center">
                <span className="logo-preview-title">{t('onboarding.pathB.uploadPreviewTitle', 'Your Logo')}</span>
                <div className="logo-canvas-wrap" style={{ backgroundColor: logoStyle.bgColor }}>
                  {logoStyle.image ? (
                    <img
                      className="logo-canvas-svg"
                      src={logoStyle.image}
                      alt={formData.logoText || formData.businessName}
                    />
                  ) : (
                    <div className="logo-upload-empty">
                      <i className="fa-regular fa-image"></i>
                      <small>{t('onboarding.pathB.uploadEmpty', 'Your uploaded logo will appear here')}</small>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* NO LOGO: AI GENERATION + MANUAL DESIGNER */}
          {hasLogo === 'no' && (
            <>
              {/* AI LOGO GENERATION PANEL */}
              <div className="logo-gen-panel glass-card">
                <div className="flex-between logo-gen-head">
                  <p className="logo-gen-hint">{t('onboarding.logoGen.hint', '4 unique marks designed from your name, category and brand tone — pick one or customize manually below.')}</p>
                  <button
                    type="button"
                    className="btn btn-accent btn-sm"
                    onClick={handleGenerateLogos}
                    disabled={generatingLogos}
                    id="btn_generate_logos"
                  >
                    {generatingLogos
                      ? t('common.generating', 'Generating...')
                      : logoVariants.length > 0
                        ? t('onboarding.logoGen.regenerate', '↻ Regenerate')
                        : t('onboarding.logoGen.cta', '✦ Generate logo with AI')}
                  </button>
                </div>

                {logoGenError && <p className="logo-gen-error">{logoGenError}</p>}

                {logoVariants.length > 0 && (
                  <div className="logo-variant-grid">
                    {logoVariants.map((l, idx) => (
                      <button
                        key={idx}
                        type="button"
                        id={`btn_logo_variant_${idx}`}
                        className={`logo-variant-card ${selectedVariantIdx === idx ? 'selected' : ''}`}
                        style={{ backgroundColor: l.palette?.bg }}
                        onClick={() => handleSelectLogoVariant(l, idx)}
                      >
                        <img
                          src={'data:image/svg+xml;utf8,' + encodeURIComponent(l.svg)}
                          alt={t('onboarding.logoGen.variantAlt', { defaultValue: 'Logo variant {{num}}', num: idx + 1 })}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid-2 logo-designer-grid">
                <div className="logo-controls">
                  <div className="form-group">
                    <label className="form-label" htmlFor="inp_logo_text">{t('onboarding.logoText', 'Logo Text')}</label>
                    <input
                      type="text"
                      id="inp_logo_text"
                      className="input-field"
                      value={formData.logoText}
                      onChange={(e) => handleInputChange('logoText', e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t('onboarding.pathB.iconLabel', 'Icon Symbol')}</label>
                    <div className="flex-gap-8">
                      {['☕', '✦', '⚡', '🛡️', '👑', '💄', '🍕', '💼'].map((symbol) => (
                        <button
                          key={symbol}
                          type="button"
                          className={`btn btn-secondary btn-sm icon-btn ${logoStyle.icon === symbol ? 'active' : ''}`}
                          onClick={() => setLogoStyle(p => ({ ...p, icon: symbol }))}
                        >
                          {symbol}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t('onboarding.pathB.colorLabel', 'Color Themes')}</label>
                    <div className="color-presets">
                      {['#D4A373', '#FF7F11', '#3A86F0', '#FF007F', '#E5C158', '#06D6A0'].map((colorHex) => (
                        <div
                          key={colorHex}
                          className="color-preset-circle"
                          style={{ backgroundColor: colorHex, border: logoStyle.color === colorHex ? '3px solid #fff' : 'none' }}
                          onClick={() => setLogoStyle(p => ({ ...p, color: colorHex }))}
                        ></div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* LIVE PREVIEW OF LOGO USING SVG LAYOUTS */}
                <div className="logo-preview-card glass-card text-center">
                  <span className="logo-preview-title">{t('onboarding.pathB.logoPreviewTitle', 'Vector SVG Blueprint')}</span>
                  <div className="logo-canvas-wrap" style={{ backgroundColor: logoStyle.bgColor }}>
                    {logoStyle.svg ? (
                      <img
                        className="logo-canvas-svg"
                        src={'data:image/svg+xml;utf8,' + encodeURIComponent(logoStyle.svg)}
                        alt={formData.logoText || formData.businessName}
                      />
                    ) : (
                      <>
                        <div className="logo-canvas-shape circle" style={{ borderColor: logoStyle.color, color: logoStyle.color }}>
                          <span className="logo-canvas-icon">{logoStyle.icon}</span>
                        </div>
                        <h3 className="logo-canvas-text" style={{ color: logoStyle.color }}>{formData.logoText || formData.businessName}</h3>
                        <small className="logo-canvas-slogan">{formData.slogan}</small>
                      </>
                    )}
                  </div>
                  <p className="text-muted mt-10"><i className="fa-solid fa-sparkles"></i> {t('onboarding.pathB.logoPreviewNote', 'AI generates full visual assets from these design guidelines')}</p>
                </div>
              </div>
            </>
          )}

          <div className="action-buttons-wrap">
            <button className="btn btn-secondary" onClick={handlePrevStep} id="btn_step3_back">{t('common.back', 'Back')}</button>
            <button className="btn btn-primary" onClick={handleNextStep} id="btn_step3_next" disabled={hasLogo === null}>
              {t('onboarding.pathB.step3Cta', 'Select Social Channels')} <i className="fa-solid fa-arrow-right"></i>
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: CHANNELS SELECTION */}
      {step === 4 && (
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

            {/* INSTAGRAM */}
            <div className={`result-item glass-card ${channels.instagram ? 'active' : ''}`} onClick={() => setChannels(p => ({ ...p, instagram: !p.instagram }))} id="btn_select_instagram">
              <div className="result-status">
                <span className="platform-icon instagram"><i className="fa-brands fa-instagram"></i></span>
                <div>
                  <h4>{t('onboarding.channels.instagramTitle', 'Instagram Creator Account')}</h4>
                  <p>{t('onboarding.channels.instagramOauth', 'Connect via OAuth to manage your Instagram account')}</p>
                </div>
              </div>
              <div className="checkbox-wrap">
                <i className={`fa-solid ${channels.instagram ? 'fa-square-check checked-icon' : 'fa-square unchecked-icon'}`}></i>
              </div>
            </div>

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

          <div className="action-buttons-wrap">
            <button className="btn btn-secondary" onClick={handlePrevStep} id="btn_step4_back">{t('common.back', 'Back')}</button>
            <button className="btn btn-accent btn-lg" onClick={startActionPipeline} id="btn_start_pipeline">
              {t('onboarding.pathB.scaffoldCta', 'Scaffold My Business')} <i className="fa-solid fa-rocket animate-pulse"></i>
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: PIPELINE EXECUTION */}
      {step === 5 && (
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
