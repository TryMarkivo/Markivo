import { useState, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import api from '../lib/api';
import './ContentEngine.css';

export default function ContentEngine({ activeProfile }) {
  const { t } = useTranslation();
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
      setTgPostResult(err.message || t('content.telegram.postFailed', 'Posting failed'));
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
        post: t('content.fallback.post', {
          defaultValue: '✨ Special offer from #{{businessName}}! ✨\n\nLooking for the perfect spot? {{topic}}\n\n📍 Visit us today in Tashkent!\n\n#localbusiness #tashkent #vibe',
          businessName: activeProfile.businessName,
          topic,
        }),
        mediaTip: t('content.fallback.mediaTip', '📸 Tip: Snap a landscape photo of your storefront at dusk with warm interior lighting glowing through the windows.')
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
      { step: t('content.tutorials.cafe.step1Title', '1. The Perfect Steam Pour'), tip: t('content.tutorials.cafe.step1Tip', 'Use a slow panning motion holding your phone at a 45-degree angle. Zoom 2x to isolate the cup detail against a soft-focus background.') },
      { step: t('content.tutorials.cafe.step2Title', '2. Golden Hour Lighting'), tip: t('content.tutorials.cafe.step2Tip', 'Shoot near your main windows between 4:00 PM and 5:30 PM. Let the natural local light trace the edge of coffee cups or pastries.') },
      { step: t('content.tutorials.cafe.step3Title', '3. Cozy Booth Workspace Vibe'), tip: t('content.tutorials.cafe.step3Tip', 'Stand at the corner of a booth. Place a laptop showing active code or designs next to a freshly served cappuccino to simulate standard workspaces.') }
    ],
    'Beauty Salon / Spa': [
      { step: t('content.tutorials.beauty.step1Title', '1. Crisp Close-up Texture'), tip: t('content.tutorials.beauty.step1Tip', 'Use ring-light setups directly facing the client. Focus on clean hair cutlines or macro shot lashes at 3x zoom.') },
      { step: t('content.tutorials.beauty.step2Title', '2. Before / After Frames'), tip: t('content.tutorials.beauty.step2Tip', 'Position the client in the exact same chair, maintaining the head alignment to ensure clean side-by-side post comparisons.') }
    ]
  };

  const tutorials = categoryTutorials[activeProfile.category] || categoryTutorials['Cafe / Coffee Shop'];

  // Display-only label map: lookup values stay English, label is translated
  const categoryKeyMap = {
    'Cafe / Coffee Shop': 'cafe',
    'Beauty Salon / Spa': 'beauty',
    'Co-working & Study Space': 'coworking',
    'Retail Boutique / Fashion': 'retail',
    'Local Restaurant / Food': 'restaurant',
    'Professional Tech Agency': 'tech',
  };
  const categoryLabel = categoryKeyMap[activeProfile.category]
    ? t(`onboarding.categories.${categoryKeyMap[activeProfile.category]}`, activeProfile.category)
    : activeProfile.category;

  return (
    <div className="content-engine-container animate-fade-in">
      <div className="grid-2 main-content-grids">
        
        {/* --- AI COPYWRITER PANEL --- */}
        <div className="copywriter-panel glass-card">
          <div className="panel-title-wrap">
            <i className="fa-solid fa-pen-nib text-accent icon-header"></i>
            <div>
              <h3>{t('content.copywriter.title', 'Multilingual AI Copywriter')}</h3>
              <p className="text-muted">{t('content.copywriter.subtitle', 'Generate scheduled posts formatted specifically per channel')}</p>
            </div>
          </div>

          <form onSubmit={handleGenerateCopy} className="mt-20">
            <div className="form-group">
              <label className="form-label">{t('content.copywriter.platformLabel', 'Destination Platform')}</label>
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
              <label className="form-label">{t('content.copywriter.languageLabel', 'Post Language')}</label>
              <div className="platform-radio-group">
                <button
                  type="button"
                  className={`platform-select-btn ${langMode === 'en' ? 'active' : ''}`}
                  onClick={() => setLangMode('en')}
                  id="btn_lang_en"
                >
                  {t('content.copywriter.langEn', '🇬🇧 English')}
                </button>
                <button
                  type="button"
                  className={`platform-select-btn ${langMode === 'multi' ? 'active' : ''}`}
                  onClick={() => setLangMode('multi')}
                  id="btn_lang_multi"
                >
                  {t('content.copywriter.langMulti', '🌐 EN + UZ + RU')}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="inp_topic">{t('content.copywriter.topicLabel', 'What is the focus of this post?')}</label>
              <textarea
                id="inp_topic"
                className="input-field text-area"
                rows="3"
                placeholder={t('content.copywriter.topicPlaceholder', 'e.g. Free honeycomb cake slices with every double espresso this weekend!')}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                required
              ></textarea>
            </div>

            <button type="submit" className="btn btn-primary w-full" disabled={loadingCopy || !topic} id="btn_generate_copy">
              {loadingCopy ? t('content.copywriter.generating', 'Crafting localized drafts...') : t('content.copywriter.generateCta', 'Generate Platform Drafts ✦')}
            </button>
          </form>

          {/* GENERATED COPY OUTLINE */}
          {generatedCopy && (
            <div className="generated-output-box glass-card mt-20 animate-fade-in">
              <div className="output-header flex-between">
                <span className="badge badge-primary"><i className="fa-solid fa-code-merge"></i> {t('content.output.toneOptimized', 'Platform Tone-Optimized')}</span>
                <small className="text-muted">{langMode === 'multi' ? t('content.output.langMulti', 'English + Uzbek + Russian') : t('content.output.langEn', 'English')}</small>
              </div>
              <div className="output-content">
                <pre className="copy-text-area">{generatedCopy.post}</pre>
              </div>
              
              <div className="output-tips-card">
                <h5><i className="fa-solid fa-lightbulb text-accent"></i> {t('content.output.mediaTipTitle', 'Recommended Photography Frame')}</h5>
                <p>{generatedCopy.mediaTip}</p>
              </div>

              <div className="output-actions flex-between mt-20">
                <button className="btn btn-secondary btn-sm" onClick={() => setGeneratedCopy(null)} id="btn_discard_post">{t('common.discard', 'Discard')}</button>
                <div className="flex-gap-8">
                  {platform === 'Telegram' && telegramReady && tgPostResult !== 'ok' && (
                    <button className="btn btn-primary btn-sm" onClick={handlePostToTelegram} disabled={tgPosting} id="btn_post_telegram_now">
                      <i className="fa-brands fa-telegram"></i> {tgPosting ? t('content.telegram.publishing', 'Publishing…') : t('content.telegram.postNow', { defaultValue: 'Post to {{chatTitle}} now', chatTitle: tgStatus.chat.chatTitle })}
                    </button>
                  )}
                  {tgPostResult === 'ok' && (
                    <span className="badge badge-success py-10 px-20 font-bold"><i className="fa-solid fa-circle-check"></i> {t('content.telegram.published', 'Published to Telegram')}</span>
                  )}
                  {!scheduled ? (
                    <button className="btn btn-accent btn-sm" onClick={handleSchedule} id="btn_schedule_post">
                      <i className="fa-solid fa-calendar-check"></i> {t('content.output.approveSchedule', 'Approve & Schedule')}
                    </button>
                  ) : (
                    <span className="badge badge-success py-10 px-20 font-bold"><i className="fa-solid fa-circle-check"></i> {t('content.output.scheduled', 'Scheduled')}</span>
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
            <h3>{t('content.enhancer.title', 'AI Photo Enhancement')}</h3>
            <p className="panel-subtitle">{t('content.enhancer.subtitle', 'Upload smartphone photos and let our AI optimize brightness, textures & contrast')}</p>

            <div 
              className="before-after-container" 
              onMouseMove={handleSliderMove}
              onTouchMove={(e) => { if (e.touches[0]) handleSliderMove(e.touches[0]); }}
            >
              {/* After Image (Enhanced) */}
              <div className="image-after" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=500&auto=format&fit=crop')` }}>
                <span className="image-label label-after">{t('content.enhancer.afterLabel', 'Enhanced AI Frame')}</span>
              </div>
              
              {/* Before Image (Raw) */}
              <div className="image-before" style={{ 
                backgroundImage: `url('https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=500&auto=format&fit=crop')`,
                clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)` 
              }}>
                <span className="image-label label-before">{t('content.enhancer.beforeLabel', 'Raw Phone Photo')}</span>
              </div>

              {/* Slider Line Divider */}
              <div className="slider-divider" style={{ left: `${sliderPosition}%` }}>
                <div className="slider-handle">
                  <i className="fa-solid fa-arrows-left-right"></i>
                </div>
              </div>
            </div>
            <p className="text-center text-muted mt-10"><i className="fa-solid fa-circle-info"></i> {t('content.enhancer.hint', 'Hover or drag across the frame to preview raw smartphone vs. AI optimized results')}</p>
          </div>

          {/* PHOTOGRAPHY GUIDES */}
          <div className="tutorials-box glass-card">
            <h3>{t('content.tutorials.title', 'Dynamic Phone Photography Guide')}</h3>
            <p className="panel-subtitle">
              <Trans
                i18nKey="content.tutorials.subtitle"
                defaults="Step-by-step creative angles customized to <1>{{category}}</1> spaces"
                values={{ category: categoryLabel }}
                components={{ 1: <strong /> }}
              />
            </p>

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
