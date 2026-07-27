import { useState, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import api from '../lib/api';
import TemplateStudio from './TemplateStudio';
import { metaFor, FALLBACK_CATALOGUE } from '../lib/platforms';
import './ContentEngine.css';

export default function ContentEngine({ activeProfile }) {
  const { t, i18n } = useTranslation();

  // --- Platform tabs -------------------------------------------------------
  // One tab per platform the connector registry exposes, so each channel gets
  // its own room (composer + its own templates) instead of sharing one form.
  const [catalogue, setCatalogue] = useState(null);
  const [connectStatus, setConnectStatus] = useState({});
  const [hasConnections, setHasConnections] = useState(true);
  const [platformKey, setPlatformKey] = useState(null);
  const [mode, setMode] = useState('compose'); // 'compose' | 'templates'

  const [topic, setTopic] = useState('');
  const [langMode, setLangMode] = useState('en'); // 'en' | 'multi'
  const [loadingCopy, setLoadingCopy] = useState(false);
  const [generatedCopy, setGeneratedCopy] = useState(null);
  const [tgStatus, setTgStatus] = useState(null);
  const [tgPosting, setTgPosting] = useState(false);
  const [tgPostResult, setTgPostResult] = useState(null); // null | 'ok' | error string

  // Two-step schedule picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerStep, setPickerStep] = useState(1); // 1 = date, 2 = time
  const [pickedDate, setPickedDate] = useState('');
  const [pickedTime, setPickedTime] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(null); // localized display string once scheduled
  const [scheduleError, setScheduleError] = useState(null);

  // Post Now state
  const [postingNow, setPostingNow] = useState(false);
  const [postedMsg, setPostedMsg] = useState(null);
  const [postNowError, setPostNowError] = useState(null);

  useEffect(() => {
    api.get('/api/telegram/status').then(setTgStatus).catch(() => setTgStatus(null));
  }, [activeProfile]);

  useEffect(() => {
    api.get('/api/connect/status')
      .then((data) => {
        const all = data.catalogue && data.catalogue.length ? data.catalogue : FALLBACK_CATALOGUE;
        const status = data.status || {};
        // The menu lists only CONNECTED platforms — every social network works
        // differently, and there is no point offering a composer for a channel
        // that cannot receive the post. Nothing connected yet falls back to the
        // full list so the engine is still explorable.
        const connected = all.filter((p) => status[p.key] && status[p.key].connected);
        const menu = connected.length ? connected : all;
        setCatalogue(menu);
        setConnectStatus(status);
        setHasConnections(connected.length > 0);
        setPlatformKey((current) => current || menu[0].key);
      })
      .catch(() => {
        setCatalogue(FALLBACK_CATALOGUE);
        setPlatformKey((current) => current || FALLBACK_CATALOGUE[0].key);
      });
  }, [activeProfile]);

  const platform = catalogue && platformKey ? catalogue.find((p) => p.key === platformKey) : null;
  const platformMeta = platformKey ? metaFor(platformKey) : null;
  // The name /api/content/* speaks ('instagram'), not the connector key
  // ('meta_instagram').
  const generationKey = platformMeta ? platformMeta.generationKey : 'instagram';
  const isTelegram = platformKey === 'telegram';
  const telegramReady = !!(tgStatus?.connected && tgStatus?.chat);

  // Before-After slider state
  const [sliderPosition, setSliderPosition] = useState(50);

  const fmtDateInput = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayStr = fmtDateInput(new Date());
  const dateOffset = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return fmtDateInput(d);
  };

  const resetPostFlows = () => {
    setPickerOpen(false);
    setPickerStep(1);
    setPickedDate('');
    setPickedTime('');
    setScheduledAt(null);
    setScheduleError(null);
    setPostedMsg(null);
    setPostNowError(null);
  };

  // Switching platform tabs clears the draft — copy written for TikTok should
  // never silently ship to Google Business.
  const handleSelectPlatform = (key) => {
    if (key === platformKey) return;
    setPlatformKey(key);
    setGeneratedCopy(null);
    setTgPostResult(null);
    resetPostFlows();
  };

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

  const handleGenerateCopy = async (e) => {
    e.preventDefault();
    if (!topic.trim()) return;

    setLoadingCopy(true);
    resetPostFlows();
    setTgPostResult(null);
    try {
      const data = await api.post('/api/content/copywrite', {
        platform: generationKey,
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

  // A filled template drops straight into the composer output, ready to post or
  // schedule through the same approval path as generated copy.
  const handleUseTemplate = (text) => {
    resetPostFlows();
    setTgPostResult(null);
    setGeneratedCopy({
      post: text,
      mediaTip: t('templates.fromTemplateTip', 'Filled from one of your saved templates — review it, then post or schedule.'),
    });
    setMode('compose');
  };

  const handleSliderMove = (e) => {
    const containerRect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - containerRect.left;
    const percentage = Math.max(0, Math.min(100, (x / containerRect.width) * 100));
    setSliderPosition(percentage);
  };

  // Opens the inline two-step picker (date -> time) instead of instantly scheduling.
  const handleSchedule = () => {
    setPickerOpen(true);
    setPickerStep(1);
    setScheduleError(null);
    if (!pickedDate) setPickedDate(todayStr);
  };

  const handleConfirmSchedule = async () => {
    if (!pickedDate || !pickedTime || scheduling || !generatedCopy) return;
    setScheduling(true);
    setScheduleError(null);
    try {
      const when = new Date(`${pickedDate}T${pickedTime}`);
      await api.post('/api/content/schedule', {
        platform: generationKey,
        postText: generatedCopy.post,
        scheduledTime: when.toISOString(),
      });
      setScheduledAt(when.toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }));
      setPickerOpen(false);
    } catch (err) {
      setScheduleError(err.message || t('content.schedule.failed', 'Scheduling failed'));
    }
    setScheduling(false);
  };

  const handlePostNow = async () => {
    if (!generatedCopy || postingNow) return;
    setPostingNow(true);
    setPostNowError(null);
    try {
      const response = await api.post('/api/content/post-now', {
        platform: generationKey,
        postText: generatedCopy.post,
      });
      setPostedMsg(
        response.simulated
          ? t('content.output.postedSimulated', 'Logged as posted — live channel publishing activates with integrations')
          : t('content.output.postedReal', { defaultValue: 'Published to {{target}}!', target: response.chatTitle })
      );
    } catch (err) {
      setPostNowError(err.message || t('content.output.postNowFailed', 'Posting failed'));
    }
    setPostingNow(false);
  };

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

  // Category-aware generic fallback so non-cafe businesses never see cafe-specific tips
  const genericTutorials = [
    {
      step: t('content.tutorials.generic.step1Title', '1. Signature Detail Close-up'),
      tip: t('content.tutorials.generic.step1Tip', {
        defaultValue: 'Get close to the detail customers love most about your {{category}}. Use 2x zoom, keep the subject sharp and let the background blur softly.',
        category: categoryLabel,
      }),
    },
    {
      step: t('content.tutorials.generic.step2Title', '2. Golden Hour Lighting'),
      tip: t('content.tutorials.generic.step2Tip', {
        defaultValue: 'Shoot near your largest window between 4:00 PM and 5:30 PM so warm natural light traces the edges of your {{category}} space.',
        category: categoryLabel,
      }),
    },
    {
      step: t('content.tutorials.generic.step3Title', '3. People in the Frame'),
      tip: t('content.tutorials.generic.step3Tip', {
        defaultValue: 'Capture a candid moment of a customer or team member enjoying your {{category}} — faces and movement outperform empty-room shots.',
        category: categoryLabel,
      }),
    },
  ];

  const tutorials = categoryTutorials[activeProfile.category] || genericTutorials;

  if (!catalogue || !platform) {
    return <div className="text-center" style={{ padding: 40 }}><i className="fa-solid fa-spinner fa-spin fa-2x text-accent"></i></div>;
  }

  return (
    <div className="content-engine-layout animate-fade-in">

      {/* --- PLATFORM MENU (vertical, connected channels only) --- */}
      <nav className="platform-menu" aria-label={t('content.platformTabsLabel', 'Platform')}>
        <span className="platform-menu-label">{t('content.yourChannels', 'Your channels')}</span>
        <div className="platform-menu-items" role="tablist">
          {catalogue.map((p) => {
            const m = metaFor(p.key);
            const isConnected = !!(connectStatus[p.key] && connectStatus[p.key].connected);
            return (
              <button
                key={p.key}
                role="tab"
                aria-selected={p.key === platformKey}
                className={`platform-menu-item ${p.key === platformKey ? 'active' : ''}`}
                onClick={() => handleSelectPlatform(p.key)}
                id={`btn_platform_tab_${p.key}`}
              >
                <i className={`${m.icon} platform-menu-icon`} style={{ color: m.color }}></i>
                <span className="platform-menu-name">{p.label}</span>
                {isConnected && (
                  <span
                    className="platform-menu-dot"
                    title={t('connections.state.connected', 'Connected')}
                    aria-label={t('connections.state.connected', 'Connected')}
                  ></span>
                )}
              </button>
            );
          })}
        </div>

        {!hasConnections && (
          <p className="platform-menu-empty text-muted">
            <i className="fa-solid fa-circle-info"></i>{' '}
            {t('content.noConnections', 'No channels connected yet — connect one in Connections to publish for real.')}
          </p>
        )}
      </nav>

      <div className="content-engine-container">
        {/* --- COMPOSE / TEMPLATES SWITCH --- */}
        <div className="engine-mode-tabs">
          <button
            className={`picker-chip ${mode === 'compose' ? 'active' : ''}`}
            onClick={() => setMode('compose')}
            id="btn_engine_mode_compose"
          >
            <i className="fa-solid fa-pen-nib"></i> {t('content.modeCompose', 'Compose')}
          </button>
          <button
            className={`picker-chip ${mode === 'templates' ? 'active' : ''}`}
            onClick={() => setMode('templates')}
            id="btn_engine_mode_templates"
          >
            <i className="fa-solid fa-shapes"></i> {t('content.modeTemplates', 'Templates')}
          </button>
        </div>

      {mode === 'templates' ? (
        <TemplateStudio
          key={platformKey}
          platformKey={platformKey}
          platformLabel={platform.label}
          onUseTemplate={handleUseTemplate}
        />
      ) : (
      <div className="grid-2 main-content-grids">

        {/* --- AI COPYWRITER PANEL --- */}
        <div className="copywriter-panel glass-card">
          <div className="panel-title-wrap">
            <i className="fa-solid fa-pen-nib text-accent icon-header"></i>
            <div>
              <h3>{t('content.copywriter.title', 'Multilingual AI Copywriter')}</h3>
              <p className="text-muted">
                {t('content.copywriter.subtitleForPlatform', {
                  defaultValue: 'Writing for {{platform}} — formatted the way that channel expects.',
                  platform: platform.label,
                })}
              </p>
            </div>
          </div>

          <form onSubmit={handleGenerateCopy} className="mt-20">
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
                placeholder={t('content.copywriter.topicPlaceholderByCategory', {
                  defaultValue: 'e.g. A weekend special offer your {{category}} customers will love!',
                  category: categoryLabel,
                })}
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
                <span className="badge badge-primary"><i className="fa-solid fa-code-merge"></i> {platform.label}</span>
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
                <button className="btn btn-secondary btn-sm" onClick={() => { setGeneratedCopy(null); resetPostFlows(); }} id="btn_discard_post">{t('common.discard', 'Discard')}</button>
                <div className="flex-gap-8">
                  {isTelegram && telegramReady && tgPostResult !== 'ok' && (
                    <button className="btn btn-primary btn-sm" onClick={handlePostToTelegram} disabled={tgPosting} id="btn_post_telegram_now">
                      <i className="fa-brands fa-telegram"></i> {tgPosting ? t('content.telegram.publishing', 'Publishing…') : t('content.telegram.postNow', { defaultValue: 'Post to {{chatTitle}} now', chatTitle: tgStatus.chat.chatTitle })}
                    </button>
                  )}
                  {tgPostResult === 'ok' && (
                    <span className="badge badge-success py-10 px-20 font-bold"><i className="fa-solid fa-circle-check"></i> {t('content.telegram.published', 'Published to Telegram')}</span>
                  )}
                  {postedMsg ? (
                    <span className="badge badge-success py-10 px-20 font-bold"><i className="fa-solid fa-circle-check"></i> {postedMsg}</span>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={handlePostNow} disabled={postingNow} id="btn_post_now">
                      <i className="fa-solid fa-paper-plane"></i> {postingNow ? t('content.output.postingNow', 'Posting…') : t('content.output.postNowCta', 'Post Now')}
                    </button>
                  )}
                  {!scheduledAt ? (
                    <button className="btn btn-accent btn-sm" onClick={handleSchedule} id="btn_schedule_post">
                      <i className="fa-solid fa-calendar-check"></i> {t('content.output.approveSchedule', 'Approve & Schedule')}
                    </button>
                  ) : (
                    <span className="badge badge-success py-10 px-20 font-bold"><i className="fa-solid fa-circle-check"></i> {t('content.output.scheduledAt', { defaultValue: 'Scheduled · {{when}}', when: scheduledAt })}</span>
                  )}
                </div>
              </div>

              {/* INLINE TWO-STEP SCHEDULE PICKER */}
              {pickerOpen && !scheduledAt && (
                <div className="schedule-picker-panel animate-fade-in">
                  {pickerStep === 1 ? (
                    <>
                      <div className="picker-step-label">{t('content.schedule.stepDate', 'Step 1 · Pick a date')}</div>
                      <input
                        type="date"
                        id="inp_schedule_date"
                        className="input-field picker-input"
                        min={todayStr}
                        value={pickedDate}
                        onChange={(e) => setPickedDate(e.target.value)}
                      />
                      <div className="picker-chips">
                        {[
                          { label: t('content.schedule.chipToday', 'Today'), days: 0 },
                          { label: t('content.schedule.chipTomorrow', 'Tomorrow'), days: 1 },
                          { label: t('content.schedule.chipIn3Days', 'In 3 days'), days: 3 },
                        ].map((chip) => (
                          <button
                            key={chip.days}
                            type="button"
                            className={`picker-chip ${pickedDate === dateOffset(chip.days) ? 'active' : ''}`}
                            onClick={() => { setPickedDate(dateOffset(chip.days)); setPickerStep(2); }}
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>
                      <div className="picker-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPickerOpen(false)}>{t('common.cancel', 'Cancel')}</button>
                        <button type="button" className="btn btn-primary btn-sm" disabled={!pickedDate || pickedDate < todayStr} onClick={() => setPickerStep(2)}>{t('common.next', 'Next')}</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="picker-step-label">{t('content.schedule.stepTime', 'Step 2 · Pick a time')}</div>
                      <input
                        type="time"
                        id="inp_schedule_time"
                        className="input-field picker-input"
                        value={pickedTime}
                        onChange={(e) => setPickedTime(e.target.value)}
                      />
                      <div className="picker-chips">
                        {[
                          { label: t('content.schedule.chipMorning', 'Morning 09:00'), value: '09:00' },
                          { label: t('content.schedule.chipLunch', 'Lunch 13:00'), value: '13:00' },
                          { label: t('content.schedule.chipEvening', 'Evening 18:30'), value: '18:30' },
                        ].map((chip) => (
                          <button
                            key={chip.value}
                            type="button"
                            className={`picker-chip ${pickedTime === chip.value ? 'active' : ''}`}
                            onClick={() => setPickedTime(chip.value)}
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>
                      <div className="picker-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPickerStep(1)}>{t('common.back', 'Back')}</button>
                        <button type="button" className="btn btn-accent btn-sm" id="btn_confirm_schedule" disabled={!pickedTime || scheduling} onClick={handleConfirmSchedule}>
                          <i className="fa-solid fa-calendar-check"></i> {scheduling ? t('content.schedule.scheduling', 'Scheduling…') : t('content.schedule.confirm', 'Confirm Schedule')}
                        </button>
                      </div>
                    </>
                  )}
                  {scheduleError && (
                    <div className="auth-error-box mt-10">{scheduleError}</div>
                  )}
                </div>
              )}

              {tgPostResult && tgPostResult !== 'ok' && (
                <div className="auth-error-box mt-10">{tgPostResult}</div>
              )}
              {postNowError && (
                <div className="auth-error-box mt-10">{postNowError}</div>
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
      )}
      </div>
    </div>
  );
}
