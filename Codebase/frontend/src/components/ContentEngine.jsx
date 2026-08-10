import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import TemplateStudio from './TemplateStudio';
import MediaAttach from './MediaAttach';
import { metaFor, FALLBACK_CATALOGUE } from '../lib/platforms';
import './ContentEngine.css';

// Language chips, in the order they are OFFERED. What the owner actually gets
// is their own click order (see `langs` state) — a Tashkent business usually
// wants Uzbek first, then Russian, then English, and the post has to read that
// way in the single message it publishes.
const LANGUAGES = [
  { code: 'uz', flag: '🇺🇿', label: 'Uzbek' },
  { code: 'ru', flag: '🇷🇺', label: 'Russian' },
  { code: 'en', flag: '🇬🇧', label: 'English' },
];

export default function ContentEngine({ activeProfile, onGoToConnections }) {
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
  // Ordered list of language codes — the array ORDER is the output order.
  const [langs, setLangs] = useState(['en']);
  const [loadingCopy, setLoadingCopy] = useState(false);
  const [generatedCopy, setGeneratedCopy] = useState(null);
  // The owner can edit Mark's draft before posting. We keep the original draft
  // (generatedCopy.post) and the edited text separately so the backend can learn
  // from the edit (a stronger taste signal than an unedited approval).
  const [editedPost, setEditedPost] = useState('');
  // Photo/video that ships with the post. Instagram cannot publish without it.
  const [media, setMedia] = useState(null);
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
  // Instagram has no text-only post type: without media the backend can only
  // record a simulated post, which is what made "Post Now" look broken here.
  const needsMedia = generationKey === 'instagram';

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
    // Nothing connected yet: the menu is only showing the full catalogue so the
    // engine is explorable. Writing a post here would go nowhere, so send the
    // owner to Connections to finish setting the channel up instead.
    if (!hasConnections && onGoToConnections) {
      onGoToConnections();
      return;
    }
    if (key === platformKey) return;
    setPlatformKey(key);
    setGeneratedCopy(null);
    setMedia(null);
    setTgPostResult(null);
    resetPostFlows();
  };

  const handlePostToTelegram = async () => {
    if (!generatedCopy || tgPosting) return;
    setTgPosting(true);
    setTgPostResult(null);
    try {
      await api.post('/api/telegram/post', { text: editedPost, mediaId: media?.id || null });
      setTgPostResult('ok');
    } catch (err) {
      setTgPostResult(err.message || t('content.telegram.postFailed', 'Posting failed'));
    }
    setTgPosting(false);
  };

  // Toggling appends to the END of the list, so the order the owner clicks in is
  // the order the languages appear in the finished post. Removing the last one
  // is refused — a post has to be in some language.
  const toggleLang = (code) => {
    setLangs((current) => {
      if (!current.includes(code)) return [...current, code];
      if (current.length === 1) return current;
      return current.filter((c) => c !== code);
    });
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
        languages: langs,
        tone: activeProfile.brandTone || activeProfile.tone,
        businessName: activeProfile.businessName,
      });
      setGeneratedCopy(data);
      setEditedPost(data.post || '');
    } catch (err) {
      console.error('Failed to generate copy, using offline presets:', err);
      // Fallback
      const fallback = {
        post: t('content.fallback.post', {
          defaultValue: '✨ Special offer from #{{businessName}}! ✨\n\nLooking for the perfect spot? {{topic}}\n\n📍 Visit us today in Tashkent!\n\n#localbusiness #tashkent #vibe',
          businessName: activeProfile.businessName,
          topic,
        }),
      };
      setGeneratedCopy(fallback);
      setEditedPost(fallback.post);
    }
    setLoadingCopy(false);
  };

  // A filled template drops straight into the composer output, ready to post or
  // schedule through the same approval path as generated copy. Any photo/video
  // saved with the template comes along, so an Instagram template is publishable
  // the moment it lands here.
  const handleUseTemplate = (text, templateMedia) => {
    resetPostFlows();
    setTgPostResult(null);
    setGeneratedCopy({ post: text });
    setEditedPost(text);
    if (templateMedia?.id) setMedia(templateMedia);
    setMode('compose');
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
        postText: editedPost,
        draftText: generatedCopy.post,
        mediaId: media?.id || null,
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
        postText: editedPost,
        draftText: generatedCopy.post,
        mediaId: media?.id || null,
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

  // NOTE: the phone-photography guide and the per-post "Recommended Photography
  // Frame" tip used to live here. Shooting advice belongs with the shoot — it is
  // all in Media Studio → Guided shoot now.

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
          <div className="platform-menu-empty text-muted">
            <p>
              <i className="fa-solid fa-circle-info"></i>{' '}
              {t('content.noConnections', 'No channels connected yet — connect one in Connections to publish for real.')}
            </p>
            {onGoToConnections && (
              <button
                type="button"
                className="btn btn-secondary btn-sm w-full mt-10"
                onClick={onGoToConnections}
                id="btn_goto_connections"
              >
                <i className="fa-solid fa-plug"></i> {t('content.goToConnections', 'Go to Connections')}
              </button>
            )}
          </div>
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
      // Single column since the photography guide moved to Media Studio.
      <div className="compose-column">

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
              <p className="form-hint text-muted">
                {t('content.copywriter.languageHint', 'Tap the languages you want. They appear in the post in the order you tap them — all in one message.')}
              </p>
              <div className="lang-chip-row">
                {LANGUAGES.map((lang) => {
                  const position = langs.indexOf(lang.code);
                  const selected = position !== -1;
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      className={`lang-chip ${selected ? 'active' : ''}`}
                      onClick={() => toggleLang(lang.code)}
                      aria-pressed={selected}
                      id={`btn_lang_${lang.code}`}
                    >
                      {selected && <span className="lang-chip-order">{position + 1}</span>}
                      <span className="lang-chip-flag">{lang.flag}</span>
                      <span>{t(`content.copywriter.lang.${lang.code}`, lang.label)}</span>
                    </button>
                  );
                })}
              </div>
              <p className="lang-order-preview text-muted">
                {t('content.copywriter.languageOrder', 'Order:')}{' '}
                <strong>{langs.map((c) => LANGUAGES.find((l) => l.code === c)?.label).join(' → ')}</strong>
              </p>
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

            <div className="form-group">
              <label className="form-label">{t('content.copywriter.mediaLabel', 'Photo or video')}</label>
              <MediaAttach
                value={media}
                onChange={setMedia}
                disabled={loadingCopy}
                hint={
                  needsMedia
                    ? t('content.copywriter.mediaRequired', 'Instagram cannot publish a text-only post — attach a photo or video to post for real.')
                    : t('content.copywriter.mediaOptional', 'Optional. Attach the image or video that should go out with this post.')
                }
              />
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
                <small className="text-muted">{langs.map((c) => LANGUAGES.find((l) => l.code === c)?.label).join(' + ')}</small>
              </div>
              <div className="output-content">
                <textarea
                  className="copy-text-area copy-text-edit"
                  value={editedPost}
                  onChange={(e) => setEditedPost(e.target.value)}
                  spellCheck={false}
                  aria-label={t('content.output.editLabel', 'Edit the post before publishing')}
                />
                {editedPost.trim() !== (generatedCopy.post || '').trim() && (
                  <small className="copy-edited-hint">
                    <i className="fa-solid fa-pen"></i> {t('content.output.edited', 'Edited — Mark will learn from your changes')}
                  </small>
                )}
                {media && (
                  <div className="output-media">
                    {media.kind === 'video'
                      ? <video src={api.mediaUrl(media.url)} controls className="output-media-thumb" />
                      : <img src={api.mediaUrl(media.url)} alt={t('media.attach.previewAlt', 'Attached media')} className="output-media-thumb" />}
                  </div>
                )}
              </div>

              {needsMedia && !media && (
                <div className="output-media-warning">
                  <i className="fa-solid fa-triangle-exclamation"></i>{' '}
                  {t('content.output.instagramNeedsMedia', 'Instagram needs a photo or video. Attach one above, or this will only be logged as a draft.')}
                </div>
              )}

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

      </div>
      )}
      </div>
    </div>
  );
}
