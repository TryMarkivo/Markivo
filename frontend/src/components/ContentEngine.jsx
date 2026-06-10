import { useState, useEffect } from 'react';
import api from '../lib/api';
import './ContentEngine.css';

export default function ContentEngine({ activeProfile }) {
  const [platform, setPlatform] = useState('Instagram');
  const [topic, setTopic] = useState('');
  const [langMode, setLangMode] = useState('en'); // 'en' | 'multi'
  const [loadingCopy, setLoadingCopy] = useState(false);
  const [generatedCopy, setGeneratedCopy] = useState(null);
  const [scheduled, setScheduled] = useState(false);
  const [tgStatus, setTgStatus] = useState(null);
  const [tgPosting, setTgPosting] = useState(false);
  const [tgPostResult, setTgPostResult] = useState(null); // null | 'ok' | error string

  useEffect(() => {
    api.get('/api/telegram/status').then(setTgStatus).catch(() => setTgStatus(null));
  }, [activeProfile]);

  const telegramReady = !!(tgStatus?.connected && tgStatus?.chat);

  const handlePostToTelegram = async () => {
    if (!generatedCopy || tgPosting) return;
    setTgPosting(true);
    setTgPostResult(null);
    try {
      await api.post('/api/telegram/post', { text: generatedCopy.post });
      setTgPostResult('ok');
    } catch (err) {
      setTgPostResult(err.message || 'Posting failed');
    }
    setTgPosting(false);
  };

  // Before-After slider state
  const [sliderPosition, setSliderPosition] = useState(50);

  const handleGenerateCopy = async (e) => {
    e.preventDefault();
    if (!topic.trim()) return;

    setLoadingCopy(true);
    setScheduled(false);
    setTgPostResult(null);
    try {
      const data = await api.post('/api/content/copywrite', {
        platform,
        topic,
        languages: langMode === 'multi' ? ['en', 'uz', 'ru'] : ['en'],
        tone: activeProfile.brandTone || activeProfile.tone,
        businessName: activeProfile.businessName,
      });
      setGeneratedCopy(data);
    } catch (err) {
      console.error('Failed to generate copy, using offline presets:', err);
      // Fallback
      setGeneratedCopy({
        post: `✨ Special offer from #${activeProfile.businessName}! ✨\n\nLooking for the perfect spot? ${topic}\n\n📍 Visit us today in Tashkent!\n\n#localbusiness #tashkent #vibe`,
        mediaTip: '📸 Tip: Snap a landscape photo of your storefront at dusk with warm interior lighting glowing through the windows.'
      });
    }
    setLoadingCopy(false);
  };

  const handleSliderMove = (e) => {
    const containerRect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - containerRect.left;
    const percentage = Math.max(0, Math.min(100, (x / containerRect.width) * 100));
    setSliderPosition(percentage);
  };

  const handleSchedule = () => {
    setScheduled(true);
  };

  // Photography tutorials customized to business category
  const categoryTutorials = {
    'Cafe / Coffee Shop': [
      { step: '1. The Perfect Steam Pour', tip: 'Use a slow panning motion holding your phone at a 45-degree angle. Zoom 2x to isolate the cup detail against a soft-focus background.' },
      { step: '2. Golden Hour Lighting', tip: 'Shoot near your main windows between 4:00 PM and 5:30 PM. Let the natural local light trace the edge of coffee cups or pastries.' },
      { step: '3. Cozy Booth Workspace Vibe', tip: 'Stand at the corner of a booth. Place a laptop showing active code or designs next to a freshly served cappuccino to simulate standard workspaces.' }
    ],
    'Beauty Salon / Spa': [
      { step: '1. Crisp Close-up Texture', tip: 'Use ring-light setups directly facing the client. Focus on clean hair cutlines or macro shot lashes at 3x zoom.' },
      { step: '2. Before / After Frames', tip: 'Position the client in the exact same chair, maintaining the head alignment to ensure clean side-by-side post comparisons.' }
    ]
  };

  const tutorials = categoryTutorials[activeProfile.category] || categoryTutorials['Cafe / Coffee Shop'];

  return (
    <div className="content-engine-container animate-fade-in">
      <div className="grid-2 main-content-grids">
        
        {/* --- AI COPYWRITER PANEL --- */}
        <div className="copywriter-panel glass-card">
          <div className="panel-title-wrap">
            <i className="fa-solid fa-pen-nib text-accent icon-header"></i>
            <div>
              <h3>Multilingual AI Copywriter</h3>
              <p className="text-muted">Generate scheduled posts formatted specifically per channel</p>
            </div>
          </div>

          <form onSubmit={handleGenerateCopy} className="mt-20">
            <div className="form-group">
              <label className="form-label">Destination Platform</label>
              <div className="platform-radio-group">
                {['Instagram', 'Telegram', 'TikTok'].map((plat) => (
                  <button
                    key={plat}
                    type="button"
                    className={`platform-select-btn ${platform === plat ? 'active' : ''}`}
                    onClick={() => setPlatform(plat)}
                  >
                    <i className={`fa-brands fa-${plat.toLowerCase()}`}></i> {plat}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Post Language</label>
              <div className="platform-radio-group">
                <button
                  type="button"
                  className={`platform-select-btn ${langMode === 'en' ? 'active' : ''}`}
                  onClick={() => setLangMode('en')}
                  id="btn_lang_en"
                >
                  🇬🇧 English
                </button>
                <button
                  type="button"
                  className={`platform-select-btn ${langMode === 'multi' ? 'active' : ''}`}
                  onClick={() => setLangMode('multi')}
                  id="btn_lang_multi"
                >
                  🌐 EN + UZ + RU
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="inp_topic">What is the focus of this post?</label>
              <textarea
                id="inp_topic"
                className="input-field text-area"
                rows="3"
                placeholder="e.g. Free honeycomb cake slices with every double espresso this weekend!"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                required
              ></textarea>
            </div>

            <button type="submit" className="btn btn-primary w-full" disabled={loadingCopy || !topic} id="btn_generate_copy">
              {loadingCopy ? 'Crafting localized drafts...' : 'Generate Platform Drafts ✦'}
            </button>
          </form>

          {/* GENERATED COPY OUTLINE */}
          {generatedCopy && (
            <div className="generated-output-box glass-card mt-20 animate-fade-in">
              <div className="output-header flex-between">
                <span className="badge badge-primary"><i className="fa-solid fa-code-merge"></i> Platform Tone-Optimized</span>
                <small className="text-muted">{langMode === 'multi' ? 'English + Uzbek + Russian' : 'English'}</small>
              </div>
              <div className="output-content">
                <pre className="copy-text-area">{generatedCopy.post}</pre>
              </div>
              
              <div className="output-tips-card">
                <h5><i className="fa-solid fa-lightbulb text-accent"></i> Recommended Photography Frame</h5>
                <p>{generatedCopy.mediaTip}</p>
              </div>

              <div className="output-actions flex-between mt-20">
                <button className="btn btn-secondary btn-sm" onClick={() => setGeneratedCopy(null)} id="btn_discard_post">Discard</button>
                <div className="flex-gap-8">
                  {platform === 'Telegram' && telegramReady && tgPostResult !== 'ok' && (
                    <button className="btn btn-primary btn-sm" onClick={handlePostToTelegram} disabled={tgPosting} id="btn_post_telegram_now">
                      <i className="fa-brands fa-telegram"></i> {tgPosting ? 'Publishing…' : `Post to ${tgStatus.chat.chatTitle} now`}
                    </button>
                  )}
                  {tgPostResult === 'ok' && (
                    <span className="badge badge-success py-10 px-20 font-bold"><i className="fa-solid fa-circle-check"></i> Published to Telegram</span>
                  )}
                  {!scheduled ? (
                    <button className="btn btn-accent btn-sm" onClick={handleSchedule} id="btn_schedule_post">
                      <i className="fa-solid fa-calendar-check"></i> Approve & Schedule
                    </button>
                  ) : (
                    <span className="badge badge-success py-10 px-20 font-bold"><i className="fa-solid fa-circle-check"></i> Scheduled</span>
                  )}
                </div>
              </div>
              {tgPostResult && tgPostResult !== 'ok' && (
                <div className="auth-error-box mt-10">{tgPostResult}</div>
              )}
            </div>
          )}
        </div>

        {/* --- PHOTO / VIDEO WORKFLOW PANEL --- */}
        <div className="media-panel">
          
          {/* BEFORE AFTER COMPARISON */}
          <div className="enhancer-box glass-card mb-20">
            <h3>AI Photo Enhancement</h3>
            <p className="panel-subtitle">Upload smartphone photos and let our AI optimize brightness, textures & contrast</p>

            <div 
              className="before-after-container" 
              onMouseMove={handleSliderMove}
              onTouchMove={(e) => { if (e.touches[0]) handleSliderMove(e.touches[0]); }}
            >
              {/* After Image (Enhanced) */}
              <div className="image-after" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=500&auto=format&fit=crop')` }}>
                <span className="image-label label-after">Enhanced AI Frame</span>
              </div>
              
              {/* Before Image (Raw) */}
              <div className="image-before" style={{ 
                backgroundImage: `url('https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=500&auto=format&fit=crop')`,
                clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)` 
              }}>
                <span className="image-label label-before">Raw Phone Photo</span>
              </div>

              {/* Slider Line Divider */}
              <div className="slider-divider" style={{ left: `${sliderPosition}%` }}>
                <div className="slider-handle">
                  <i className="fa-solid fa-arrows-left-right"></i>
                </div>
              </div>
            </div>
            <p className="text-center text-muted mt-10"><i className="fa-solid fa-circle-info"></i> Hover or drag across the frame to preview raw smartphone vs. AI optimized results</p>
          </div>

          {/* PHOTOGRAPHY GUIDES */}
          <div className="tutorials-box glass-card">
            <h3>Dynamic Phone Photography Guide</h3>
            <p className="panel-subtitle">Step-by-step creative angles customized to <strong>{activeProfile.category}</strong> spaces</p>

            <div className="tutorials-list">
              {tutorials.map((tut, index) => (
                <div key={index} className="tutorial-step-item">
                  <h4>{tut.step}</h4>
                  <p className="text-secondary">{tut.tip}</p>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
