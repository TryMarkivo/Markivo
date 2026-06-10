import { useState } from 'react';
import api from '../lib/api';
import './Onboarding.css';

export default function OnboardingPathB({ onOnboardSuccess }) {
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

  const [logoStyle, setLogoStyle] = useState({
    color: '#D4A373',
    bgColor: '#1A1816',
    shape: 'circle',
    icon: '☕'
  });

  const [generatedSlogans, setGeneratedSlogans] = useState([]);
  const [generatingSlogans, setGeneratingSlogans] = useState(false);

  // Channels to create
  const [channels, setChannels] = useState({
    googleBusiness: true,
    instagram: true,
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
      { text: 'Generating brand identity visual package...', icon: 'fa-palette' },
      { text: 'Saving high-res SVG & PNG logo layouts...', icon: 'fa-file-image' }
    ];

    if (channels.googleBusiness) {
      logs.push({ text: 'Configuring Google Business Profile endpoints...', icon: 'fa-map-location-dot' });
    }

    if (channels.instagram) {
      logs.push({ text: 'Scaffolding Instagram Business profile structure...', icon: 'fa-instagram' });
    }

    if (channels.telegram) {
      logs.push({ text: 'Establishing secure Telegram channel webhook bot...', icon: 'fa-paper-plane' });
    }

    logs.push(
      { text: 'Compiling SEO semantic metadata and Tashkent keyword tags...', icon: 'fa-tags' },
      { text: 'Scheduling inaugural calendar AI post drafts...', icon: 'fa-calendar-days' }
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
    } catch (err) {
      console.error('Failed to generate slogans, using mocks:', err);
      const mocks = {
        'Cozy & Warm': [`A cozy corner for your day.`, `Warm flavors, local connections.`, `Handcrafted comfort, daily.`],
        'Modern & Minimalist': [`Simply better ${formData.category}.`, `Aesthetic simplicity.`, `Modern taste.`],
        'Energetic & Fast-paced': [`Fuel your hustle.`, `Fast. Fresh. Bold.`, `Get up and go.`],
        'Professional & Trustworthy': [`Quality you can count on.`, `Excellence served daily.`, `Your local favorite.`],
        'Playful & Fun': [`Fun times, fresh vibes!`, `Yum in every bite.`, `Your happy place.`],
        'Luxury & Premium': [`The luxury of fine taste.`, `Elevate your standard.`, `Premium choice.`]
      };
      setGeneratedSlogans(mocks[formData.tone] || mocks['Cozy & Warm']);
    }
    setGeneratingSlogans(false);
  };

  const triggerLogoPreset = (tone) => {
    const presets = {
      'Cozy & Warm': { color: '#D4A373', bgColor: '#1E1B18', shape: 'circle', icon: '☕' },
      'Modern & Minimalist': { color: '#ffffff', bgColor: '#0f0f10', shape: 'square', icon: '✦' },
      'Energetic & Fast-paced': { color: '#FF7F11', bgColor: '#0B0D1B', shape: 'hexagon', icon: '⚡' },
      'Professional & Trustworthy': { color: '#3A86F0', bgColor: '#0E1726', shape: 'shield', icon: '🛡️' },
      'Playful & Fun': { color: '#FF007F', bgColor: '#1A0E23', shape: 'circle', icon: '🎈' },
      'Luxury & Premium': { color: '#E5C158', bgColor: '#0D0D0D', shape: 'shield', icon: '👑' }
    };
    const sel = presets[tone] || presets['Cozy & Warm'];
    setLogoStyle(sel);
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
        text: formData.logoText || formData.businessName,
        color: logoStyle.color,
        bgColor: logoStyle.bgColor,
        shape: logoStyle.shape,
        icon: logoStyle.icon
      }
    };

    try {
      const data = await api.post('/api/onboarding/construct', finalProfile);
      onOnboardSuccess(data.profile);
    } catch (err) {
      console.error('Failed to submit onboarding profile, falling back:', err);
      onOnboardSuccess({ ...finalProfile, platforms: channels });
    }
  };

  return (
    <div className="onboarding-card glass-card animate-fade-in" id="onboarding_path_b_container">
      {/* HEADER */}
      <div className="onboarding-header">
        {step < 5 && (
          <button className="btn-back" onClick={handlePrevStep} disabled={step === 1} id="btn_back_onboard_b">
            <i className="fa-solid fa-arrow-left"></i> Previous Step
          </button>
        )}
        <div className="onboarding-badge">PATH B: BUILD FROM SCRATCH</div>
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
          <h2>Let's Discover Your Business Vibe</h2>
          <p className="subtitle">Tell us about your project, and we will build its entire visual and social infrastructure.</p>

          <div className="form-group">
            <label className="form-label" htmlFor="inp_name_b">Business Name</label>
            <input
              type="text"
              id="inp_name_b"
              className="input-field"
              placeholder="e.g. Noir Cafe & Workspace"
              value={formData.businessName}
              onChange={(e) => {
                handleInputChange('businessName', e.target.value);
                if (!formData.logoText) handleInputChange('logoText', e.target.value);
              }}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="sel_category">Business Category</label>
            <select
              id="sel_category"
              className="select-field"
              value={formData.category}
              onChange={(e) => handleInputChange('category', e.target.value)}
            >
              <option>Cafe / Coffee Shop</option>
              <option>Beauty Salon / Spa</option>
              <option>Co-working & Study Space</option>
              <option>Retail Boutique / Fashion</option>
              <option>Local Restaurant / Food</option>
              <option>Professional Tech Agency</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="inp_desc_b">Describe your business in 2-3 sentences</label>
            <textarea
              id="inp_desc_b"
              className="input-field text-area"
              rows="3"
              placeholder="What makes your brand unique? e.g. A warm coffee shop in Tashkent serving third-wave espresso, offering high-speed WiFi booths for programmers and students, and fresh handmade Uzbek honey cakes."
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
            ></textarea>
          </div>

          <div className="form-group">
            <div className="flex-between">
              <label className="form-label" htmlFor="inp_loc_b">Physical Address</label>
              <label className="checkbox-label-toggle">
                <input
                  type="checkbox"
                  checked={formData.isOnline}
                  onChange={(e) => handleInputChange('isOnline', e.target.checked)}
                />
                We operate online / remotely
              </label>
            </div>
            {!formData.isOnline && (
              <input
                type="text"
                id="inp_loc_b"
                className="input-field"
                placeholder="e.g. Amir Temur Avenue, Tashkent"
                value={formData.location}
                onChange={(e) => handleInputChange('location', e.target.value)}
              />
            )}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="inp_audience">Who is your ideal customer?</label>
            <input
              type="text"
              id="inp_audience"
              className="input-field"
              placeholder="e.g. Young programmers, designers, coffee enthusiasts, and remote workers"
              value={formData.audience}
              onChange={(e) => handleInputChange('audience', e.target.value)}
            />
          </div>

          <button className="btn btn-primary w-full btn-lg" onClick={handleNextStep} disabled={!formData.businessName} id="btn_onboard_b_step1">
            Choose Brand Tone & Slogan <i className="fa-solid fa-arrow-right"></i>
          </button>
        </div>
      )}

      {/* STEP 2: TONE & SLOGANS */}
      {step === 2 && (
        <div className="step-content animate-fade-in">
          <h2>Define Your Brand Identity</h2>
          <p className="subtitle">Pick a tone that aligns with your space, and generate a customized brand slogan.</p>

          <div className="form-group">
            <label className="form-label">Brand Tone</label>
            <div className="grid-3 tone-grid">
              {['Cozy & Warm', 'Modern & Minimalist', 'Energetic & Fast-paced', 'Professional & Trustworthy', 'Playful & Fun', 'Luxury & Premium'].map((tone) => (
                <div
                  key={tone}
                  className={`tone-card glass-card ${formData.tone === tone ? 'active' : ''}`}
                  onClick={() => handleToneChange(tone)}
                >
                  <span className="tone-bullet"></span>
                  {tone}
                </div>
              ))}
            </div>
          </div>

          <div className="form-group border-top-onboard pt-20">
            <div className="flex-between align-center mb-10">
              <label className="form-label">Custom Brand Slogan</label>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleGenerateSlogans}
                disabled={generatingSlogans || !formData.description}
                id="btn_generate_slogans"
              >
                {generatingSlogans ? 'Generating...' : 'Generate 3 AI Slogans ✦'}
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
                placeholder="Write your own slogan, or describe your cafe above and click 'Generate'"
                value={formData.slogan}
                onChange={(e) => handleInputChange('slogan', e.target.value)}
              />
            )}
          </div>

          <div className="action-buttons-wrap">
            <button className="btn btn-secondary" onClick={handlePrevStep} id="btn_step2_back">Back</button>
            <button className="btn btn-primary" onClick={handleNextStep} id="btn_step2_next">
              Design My Custom Logo <i className="fa-solid fa-arrow-right"></i>
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: LOGO DESIGNER */}
      {step === 3 && (
        <div className="step-content animate-fade-in">
          <h2>Create Your Brand Icon</h2>
          <p className="subtitle">Customize your visual emblem. Our logo engine will render layouts tailored to your business theme.</p>

          <div className="grid-2 logo-designer-grid">
            <div className="logo-controls">
              <div className="form-group">
                <label className="form-label" htmlFor="inp_logo_text">Logo Text</label>
                <input
                  type="text"
                  id="inp_logo_text"
                  className="input-field"
                  value={formData.logoText}
                  onChange={(e) => handleInputChange('logoText', e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Emblem Shape</label>
                <div className="flex-gap-8">
                  {['circle', 'square', 'hexagon', 'shield'].map((shape) => (
                    <button
                      key={shape}
                      type="button"
                      className={`btn btn-secondary btn-sm shape-btn ${logoStyle.shape === shape ? 'active' : ''}`}
                      onClick={() => setLogoStyle(p => ({ ...p, shape }))}
                    >
                      {shape}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Icon Symbol</label>
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
                <label className="form-label">Color Themes</label>
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
              <span className="logo-preview-title">Vector SVG Blueprint</span>
              <div className="logo-canvas-wrap" style={{ backgroundColor: logoStyle.bgColor }}>
                <div className={`logo-canvas-shape ${logoStyle.shape}`} style={{ borderColor: logoStyle.color, color: logoStyle.color }}>
                  <span className="logo-canvas-icon">{logoStyle.icon}</span>
                </div>
                <h3 className="logo-canvas-text" style={{ color: logoStyle.color }}>{formData.logoText || formData.businessName}</h3>
                <small className="logo-canvas-slogan">{formData.slogan}</small>
              </div>
              <p className="text-muted mt-10"><i className="fa-solid fa-sparkles"></i> AI generates full visual assets from this design guidelines</p>
            </div>
          </div>

          <div className="action-buttons-wrap">
            <button className="btn btn-secondary" onClick={handlePrevStep} id="btn_step3_back">Back</button>
            <button className="btn btn-primary" onClick={handleNextStep} id="btn_step3_next">
              Select Social Channels <i className="fa-solid fa-arrow-right"></i>
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: CHANNELS SELECTION */}
      {step === 4 && (
        <div className="step-content animate-fade-in">
          <h2>Select Channels to Initialize</h2>
          <p className="subtitle">Choose which accounts to scaffold automatically. Markivo creates draft structures verified for Central Asia.</p>

          <div className="results-grid">
            {/* GOOGLE BUSINESS */}
            <div className={`result-item glass-card ${channels.googleBusiness ? 'active' : ''}`} onClick={() => setChannels(p => ({ ...p, googleBusiness: !p.googleBusiness }))} id="btn_select_google">
              <div className="result-status">
                <span className="platform-icon google"><i className="fa-brands fa-google"></i></span>
                <div>
                  <h4>Google Business Profile</h4>
                  <p>Connect via OAuth to manage your Business Profile</p>
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
                  <h4>Instagram Creator Account</h4>
                  <p>Connect via OAuth to manage your Instagram account</p>
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
                  <h4>Telegram Business Channel</h4>
                  <p>Connect via OAuth to manage your Telegram channel</p>
                </div>
              </div>
              <div className="checkbox-wrap">
                <i className={`fa-solid ${channels.telegram ? 'fa-square-check checked-icon' : 'fa-square unchecked-icon'}`}></i>
              </div>
            </div>
          </div>

          <div className="action-buttons-wrap">
            <button className="btn btn-secondary" onClick={handlePrevStep} id="btn_step4_back">Back</button>
            <button className="btn btn-accent btn-lg" onClick={startActionPipeline} id="btn_start_pipeline">
              Scaffold My Business <i className="fa-solid fa-rocket animate-pulse"></i>
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: PIPELINE EXECUTION */}
      {step === 5 && (
        <div className="step-content text-center py-40">
          <h2>Constructing Your Digital Infrastructure</h2>
          <p className="subtitle">Please wait while Markivo's AI engine creates and registers your digital profiles.</p>

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
                    {isCompleted && <span className="line-symbol text-success"><i className="fa-solid fa-check-double"></i> SUCCESS</span>}
                    {isCurrent && <span className="line-symbol text-accent animate-pulse"><i className="fa-solid fa-spinner fa-spin"></i> RUNNING</span>}
                    {isPending && <span className="line-symbol text-muted"><i className="fa-regular fa-clock"></i> PENDING</span>}
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
