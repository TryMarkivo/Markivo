import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import PublishModal from './PublishModal';
import './MediaStudio.css';

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB client-side cap
// Video generation runs for minutes. Google's own guidance is to poll every
// ~10s; MAX_POLLS bounds the wait so the spinner cannot outlive the server's
// own give-up window (VEO_MAX_WAIT_MS), after which the job is failed and the
// owner's allowance refunded.
const POLL_INTERVAL_MS = 10000;
const MAX_POLLS = 66;

// Defensive stringifier: backend fields may arrive as strings, arrays or objects.
function asText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(asText).join(', ');
  if (typeof value === 'object') return Object.values(value).map(asText).join(' · ');
  return String(value);
}

// Camera fields, in the order a photographer actually sets them.
const CAMERA_FIELDS = [
  ['device', 'Device'],
  ['lens', 'Lens'],
  ['settings', 'Settings'],
  ['whiteBalance', 'White balance'],
  ['stabilisation', 'Stabilisation'],
];

export default function MediaStudio({ activeProfile }) {
  const { t } = useTranslation();

  // Brief creation
  const [mode, setMode] = useState('full'); // 'full' | 'guided'
  const [kind, setKind] = useState('image'); // 'image' | 'video'
  const [topic, setTopic] = useState('');
  const [briefId, setBriefId] = useState(null);
  const [brief, setBrief] = useState(null);
  const [briefMode, setBriefMode] = useState(null); // mode the current brief was generated with
  const [briefKind, setBriefKind] = useState(null); // kind the current brief was generated with
  const [briefTopic, setBriefTopic] = useState(''); // what was asked for
  const [briefLoading, setBriefLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Render (full-AI image briefs)
  const [renderingId, setRenderingId] = useState(null); // media id currently rendering
  const [renders, setRenders] = useState({}); // media id -> { url } | { notice }

  // Upload
  const [uploaded, setUploaded] = useState(null); // { id, url, filename, isVideo }
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Edit plan
  const [instructions, setInstructions] = useState('');
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);

  // Library + errors
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  // Publish flow — opens once a photo/video is actually finished.
  const [publishOpen, setPublishOpen] = useState(false);

  // AI photo enhancement before/after wiper. It lives with the shoot rather
  // than the copywriter, so it moved here from the AI content engine.
  const [sliderPosition, setSliderPosition] = useState(50);

  const handleSliderMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setSliderPosition(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)));
  };

  const loadLibrary = useCallback(() => {
    api.get('/api/media')
      .then((data) => setItems(data.items || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  const handleBrief = async (e) => {
    e?.preventDefault();
    if (!topic.trim() || briefLoading) return;
    setBriefLoading(true);
    setError(null);
    setCopied(false);
    try {
      const data = await api.post('/api/media/brief', { kind, mode, topic });
      setBriefId(data.id);
      setBrief(data.brief);
      setBriefMode(mode);
      setBriefKind(kind);
      setBriefTopic(topic);
      loadLibrary();
    } catch (err) {
      setError(err.message);
    }
    setBriefLoading(false);
  };

  // Switching mode or media type abandons a brief written for the other one.
  const switchMode = (next) => {
    if (next === mode) return;
    setMode(next);
    setBrief(null);
    setBriefId(null);
    setError(null);
  };

  const handleCopyCaption = async () => {
    if (!brief?.caption) return;
    try {
      await navigator.clipboard.writeText(brief.caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleFile = (file) => {
    if (!file || uploading) return;
    setError(null);
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type === 'video/mp4' || file.type === 'video/webm';
    if (!isImage && !isVideo) {
      setError(t('media.upload.badType', 'Unsupported file type — use images, MP4 or WebM video.'));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(t('media.upload.tooLarge', 'File is too large — the maximum size is 8MB.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setUploading(true);
      try {
        const data = await api.post('/api/media/upload', {
          mediaId: briefId || undefined,
          filename: file.name,
          dataUrl: reader.result,
        });
        setUploaded({ id: data.id, url: data.url, filename: file.name, isVideo });
        setPlan(null);
        loadLibrary();
      } catch (err) {
        setError(err.message);
      }
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleEditPlan = async (e) => {
    e.preventDefault();
    if (!uploaded || !instructions.trim() || planning) return;
    setPlanning(true);
    setError(null);
    try {
      const data = await api.post(`/api/media/${uploaded.id}/edit`, { instructions });
      setPlan(data.plan);
      loadLibrary();
    } catch (err) {
      setError(err.message);
    }
    setPlanning(false);
  };

  /**
   * Poll a video job to completion.
   *
   * Video generation takes minutes, so the render call returns 202 and the
   * result arrives here. Polling stops on a terminal status or when the server
   * gives up — it never spins forever, because the job is already paid for and
   * a stuck spinner would hide a refund the owner is owed.
   */
  const pollRender = async (id) => {
    for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      let data;
      try {
        data = await api.get(`/api/media/${id}/status`);
      } catch {
        continue; // a blip; the server keeps the job in flight
      }
      if (data.status === 'rendered') {
        setRenders((prev) => ({ ...prev, [id]: { url: data.url } }));
        loadLibrary();
        return;
      }
      if (data.status === 'failed') {
        setRenders((prev) => ({
          ...prev,
          [id]: { notice: data.error || t('media.render.failed', 'Generation failed — your allowance has been returned.') },
        }));
        loadLibrary();
        return;
      }
    }
    setRenders((prev) => ({
      ...prev,
      [id]: { notice: t('media.render.stillGoing', 'Still generating — it will appear in your library when it finishes.') },
    }));
    loadLibrary();
  };

  const handleRender = async (id) => {
    if (!id || renderingId) return;
    setRenderingId(id);
    setError(null);
    try {
      const data = await api.post(`/api/media/${id}/render`, {});
      if (data.status === 'rendering') {
        // Accepted as a job (video). The button stays busy while we poll.
        await pollRender(id);
      } else {
        setRenders((prev) => ({ ...prev, [id]: { url: data.url } }));
        loadLibrary();
      }
    } catch (err) {
      // 501 keyless engine and 429 exhausted allowance are both expected
      // states with a useful server message, not errors to shout about.
      if (err.status === 501 || err.status === 429) {
        setRenders((prev) => ({ ...prev, [id]: { notice: err.message } }));
      } else {
        setError(err.message);
      }
    }
    setRenderingId(null);
  };

  const toAbsolute = (url) => (url?.startsWith('http') ? url : api.base + url);

  const mediaUrl = uploaded ? toAbsolute(uploaded.url) : null;

  // The wiper previews YOUR photo once one is uploaded; the sample frame is
  // only there so the control means something before you have shot anything.
  const enhancerImage = uploaded && !uploaded.isVideo
    ? mediaUrl
    : 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=500&auto=format&fit=crop';

  // The finished photo/video this page can post right now. A rendered AI image
  // and an uploaded file are both real files on the server with a media id, so
  // either is publishable; the current mode decides which one is "the" result.
  const renderedUrl = briefId ? renders[briefId]?.url : null;
  const uploadedMedia = uploaded
    ? { id: uploaded.id, url: uploaded.url, kind: uploaded.isVideo ? 'video' : 'image' }
    : null;
  const renderedMedia = renderedUrl ? { id: briefId, url: renderedUrl, kind: 'image' } : null;
  const postable = mode === 'guided'
    ? (uploadedMedia || renderedMedia)
    : (renderedMedia || uploadedMedia);

  // Seed the caption from the brief the AI already wrote for this shot.
  const postCaption = asText(brief?.caption) || '';

  const statusLabels = {
    brief: t('media.status.brief', 'Brief'),
    uploaded: t('media.status.uploaded', 'Uploaded'),
    edit_plan: t('media.status.edit_plan', 'Edit plan'),
    rendered: t('media.status.rendered', 'Rendered'),
    rendering: t('media.status.rendering', 'Generating…'),
    failed: t('media.status.failed', 'Failed'),
  };

  const enginePendingText = t('media.engine.pending', 'AI media engine pending — this plan is ready to run the moment the generation engine goes live.');

  const engineNote = (text) => (
    <div className="engine-pending-note">
      <i className="fa-solid fa-triangle-exclamation"></i>
      <span>{text}</span>
    </div>
  );

  const planDetails = plan ? [
    ['crop', t('media.edit.crop', 'Crop')],
    ['colorGrade', t('media.edit.colorGrade', 'Color grade')],
    ['captions', t('media.edit.captions', 'Captions')],
    ['audio', t('media.edit.audio', 'Audio')],
  ].filter(([key]) => plan[key]) : [];

  const kindToggle = (
    <div className="media-kind-toggle">
      <button
        type="button"
        className={`media-kind-btn ${kind === 'image' ? 'active' : ''}`}
        onClick={() => setKind('image')}
        id="btn_kind_image"
      >
        <i className="fa-solid fa-image"></i> {t('media.kind.image', 'Image')}
      </button>
      <button
        type="button"
        className={`media-kind-btn ${kind === 'video' ? 'active' : ''}`}
        onClick={() => setKind('video')}
        id="btn_kind_video"
      >
        <i className="fa-solid fa-video"></i> {t('media.kind.video', 'Video')}
      </button>
    </div>
  );

  // Shot list rows arrive as objects from the production brief, but older saved
  // briefs stored plain strings — render both.
  const renderShot = (shot, i) => {
    if (!shot || typeof shot !== 'object') return <li key={i}>{asText(shot)}</li>;
    const specs = [
      ['framing', t('media.shot.framing', 'Framing')],
      ['angle', t('media.shot.angle', 'Angle')],
      ['movement', t('media.shot.movement', 'Movement')],
      ['duration', t('media.shot.duration', 'Duration')],
    ].filter(([k]) => shot[k]);
    return (
      <li key={i} className="shot-row">
        <strong className="shot-name">{asText(shot.name)}</strong>
        {specs.length > 0 && (
          <span className="shot-specs">
            {specs.map(([k, label]) => (
              <span key={k} className="shot-spec"><em>{label}</em> {asText(shot[k])}</span>
            ))}
          </span>
        )}
        {shot.direction && <span className="shot-direction">{asText(shot.direction)}</span>}
      </li>
    );
  };

  const block = (icon, title, children) => (
    <div className="brief-block">
      <h4><i className={`fa-solid ${icon}`}></i> {title}</h4>
      {children}
    </div>
  );

  const textBlock = (icon, title, value) =>
    value ? block(icon, title, <p className="brief-script">{asText(value)}</p>) : null;

  const listBlock = (icon, title, arr, ordered) => {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const Tag = ordered ? 'ol' : 'ul';
    return block(icon, title, (
      <Tag className={ordered ? 'media-numbered-list' : 'brief-tips'}>
        {arr.map((v, i) => (ordered
          ? <li key={i}>{asText(v)}</li>
          : <li key={i}><i className="fa-solid fa-circle-check"></i> <span>{asText(v)}</span></li>))}
      </Tag>
    ));
  };

  return (
    <div className="media-studio animate-fade-in">

      {/* HEADER */}
      <div className="media-studio-header">
        <h2>{t('media.title', 'Media Studio')}</h2>
        <p className="text-muted">
          {t('media.subtitle', {
            defaultValue: 'Plan, shoot and edit scroll-stopping content for {{businessName}}',
            businessName: activeProfile.businessName,
          })}
        </p>
      </div>

      {error && <div className="auth-error-box">{error}</div>}

      {/* 1. MODE CHOOSER — the two modes are different jobs, so the page below
             changes completely depending on which one is selected. */}
      <div className="media-mode-grid">
        <button
          type="button"
          className={`media-mode-card glass-card ${mode === 'full' ? 'active' : ''}`}
          onClick={() => switchMode('full')}
          id="btn_mode_full"
        >
          <div className="mode-icon"><i className="fa-solid fa-wand-magic-sparkles"></i></div>
          <div className="mode-copy">
            <h4>{t('media.modes.fullTitle', 'Full AI generation')}</h4>
            <p>{t('media.modes.fullDesc', 'Describe it, AI creates and evaluates everything')}</p>
          </div>
        </button>
        <button
          type="button"
          className={`media-mode-card glass-card ${mode === 'guided' ? 'active' : ''}`}
          onClick={() => switchMode('guided')}
          id="btn_mode_guided"
        >
          <div className="mode-icon"><i className="fa-solid fa-camera"></i></div>
          <div className="mode-copy">
            <h4>{t('media.modes.guidedTitle', 'Guided shoot')}</h4>
            <p>{t('media.modes.guidedDesc', 'AI writes your full shooting plan — you film, AI edits')}</p>
          </div>
        </button>
      </div>

      {/* ================= FULL AI GENERATION =================
          Just the prompt: a short explanation of what to write, the image/video
          choice, and the box. Nothing else — the AI does the rest. */}
      {mode === 'full' && (
        <div className="media-brief-panel glass-card">
          <h3>{t('media.full.title', 'Describe what you want')}</h3>
          <p className="media-panel-subtitle">
            {t('media.full.explainer', 'Write it like you would describe it to a designer: the subject, the feeling, and where it will be posted. One or two sentences is enough — the AI fills in the rest.')}
          </p>

          <form onSubmit={handleBrief}>
            <div className="form-group">
              <label className="form-label">{t('media.brief.kindLabel', 'Media type')}</label>
              {kindToggle}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="inp_media_topic">{t('media.full.promptLabel', 'Your prompt')}</label>
              <textarea
                id="inp_media_topic"
                className="input-field media-textarea"
                rows="3"
                placeholder={t('media.full.promptPlaceholder', 'e.g. A warm overhead shot of our new seasonal latte on a wooden table, morning light, cozy and inviting')}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                required
              ></textarea>
            </div>

            <button type="submit" className="btn btn-primary w-full" disabled={briefLoading || !topic.trim()} id="btn_media_brief">
              {briefLoading
                ? <><i className="fa-solid fa-spinner fa-spin"></i> {t('media.full.generating', 'Generating...')}</>
                : <><i className="fa-solid fa-wand-magic-sparkles"></i> {t('media.full.generateCta', 'Generate')}</>}
            </button>
          </form>

          {/* FULL AI OUTPUT */}
          {brief && briefMode === 'full' && (
            <div className="brief-output animate-fade-in">
              {textBlock('fa-lightbulb', t('media.brief.conceptTitle', 'Concept'), brief.concept)}

              <div className="brief-block">
                <div className="brief-block-head">
                  <h4><i className="fa-solid fa-quote-left"></i> {t('media.brief.captionTitle', 'Ready caption')}</h4>
                  <button type="button" className="btn btn-secondary media-copy-btn" onClick={handleCopyCaption} id="btn_media_copy_caption">
                    <i className={`fa-solid ${copied ? 'fa-check' : 'fa-copy'}`}></i>{' '}
                    {copied ? t('media.brief.copied', 'Copied!') : t('media.brief.copy', 'Copy')}
                  </button>
                </div>
                <pre className="media-caption-box">{asText(brief.caption)}</pre>
              </div>

              {brief.visualSpec && (
                <div className="brief-block">
                  <h4><i className="fa-solid fa-palette"></i> {t('media.brief.visualSpecTitle', 'Visual spec')}</h4>
                  <div className="spec-chips">
                    {brief.visualSpec.composition && (
                      <span className="spec-chip">
                        <strong>{t('media.spec.composition', 'Composition')}</strong>
                        {asText(brief.visualSpec.composition)}
                      </span>
                    )}
                    {brief.visualSpec.palette && (
                      <span className="spec-chip">
                        <strong>{t('media.spec.palette', 'Palette')}</strong>
                        {asText(brief.visualSpec.palette)}
                      </span>
                    )}
                    {brief.visualSpec.mood && (
                      <span className="spec-chip">
                        <strong>{t('media.spec.mood', 'Mood')}</strong>
                        {asText(brief.visualSpec.mood)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Video renders through the same button now — it is a polled
                  job rather than a coming-soon placeholder. */}
              <div className="media-render-section">
                {renders[briefId]?.url ? (
                  <div className="render-result animate-fade-in">
                    <div className="render-success-note">
                      <i className="fa-solid fa-circle-check"></i>
                      <span>{briefKind === 'video'
                        ? t('media.render.successVideo', 'Video generated — ready to use in your posts.')
                        : t('media.render.success', 'Image rendered — ready to use in your posts.')}</span>
                    </div>
                    {briefKind === 'video' ? (
                      <video src={toAbsolute(renders[briefId].url)} controls playsInline className="render-result-video" />
                    ) : (
                      <img src={toAbsolute(renders[briefId].url)} alt={t('media.render.resultAltNamed', { defaultValue: 'Rendered image: {{topic}}', topic: briefTopic })} />
                    )}
                  </div>
                ) : (
                  <>
                    {engineNote(renders[briefId]?.notice || brief.note || enginePendingText)}
                    <button
                      type="button"
                      className="btn btn-primary w-full"
                      id="btn_media_render"
                      disabled={renderingId !== null}
                      onClick={() => handleRender(briefId)}
                    >
                      <i className={`fa-solid ${renderingId === briefId ? 'fa-spinner fa-spin' : (briefKind === 'video' ? 'fa-film' : 'fa-image')}`}></i>{' '}
                      {renderingId === briefId
                        ? (briefKind === 'video'
                          ? t('media.render.renderingVideo', 'Generating video — this takes a few minutes...')
                          : t('media.render.rendering', 'Rendering image...'))
                        : (briefKind === 'video'
                          ? t('media.render.ctaVideo', 'Generate video')
                          : t('media.render.cta', 'Render image'))}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= GUIDED SHOOT =================
          Ask what they want to shoot, send it, get back the full production
          brief a professional photographer or videographer would work from. */}
      {mode === 'guided' && (
        <>
          <div className="media-brief-panel glass-card">
            <h3>{t('media.guided.title', 'What do you want to shoot?')}</h3>
            <p className="media-panel-subtitle">
              {t('media.guided.explainer', 'Tell us what you are filming or photographing and press send. You get back the full production plan — how to set the scene, exact camera setup, and every shot to take.')}
            </p>

            <div className="form-group">
              <label className="form-label">{t('media.brief.kindLabel', 'Media type')}</label>
              {kindToggle}
            </div>

            <form onSubmit={handleBrief} className="guided-ask-row">
              <input
                id="inp_media_topic_guided"
                type="text"
                className="input-field"
                placeholder={kind === 'video'
                  ? t('media.guided.placeholderVideo', 'e.g. A short reel showing how we make our signature latte')
                  : t('media.guided.placeholderPhoto', 'e.g. Our new seasonal latte on the counter')}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                required
              />
              <button type="submit" className="btn btn-primary guided-send-btn" disabled={briefLoading || !topic.trim()} id="btn_media_brief_guided">
                {briefLoading
                  ? <i className="fa-solid fa-spinner fa-spin"></i>
                  : <i className="fa-solid fa-paper-plane"></i>}
                <span className="guided-send-label">
                  {briefLoading ? t('media.guided.thinking', 'Planning your shoot...') : t('media.guided.sendCta', 'Send')}
                </span>
              </button>
            </form>

            {/* GUIDED PRODUCTION BRIEF */}
            {brief && briefMode === 'guided' && (
              <div className="brief-output animate-fade-in">
                <div className="brief-topic-echo">
                  <i className="fa-solid fa-clapperboard"></i>
                  <span>{briefTopic}</span>
                  <span className={`media-status-chip ${briefKind === 'video' ? 'rendered' : 'brief'}`}>
                    {briefKind === 'video' ? t('media.kind.video', 'Video') : t('media.kind.image', 'Image')}
                  </span>
                </div>

                {/* Video-only: the story and how it plays out */}
                {textBlock('fa-masks-theater', t('media.brief.scenarioTitle', 'Scenario'), brief.scenario)}
                {textBlock('fa-timeline', t('media.brief.flowTitle', 'How it flows'), brief.flow)}

                {/* Staging */}
                {textBlock('fa-couch', t('media.brief.sceneTitle', 'The scene'), brief.scene)}
                {listBlock('fa-list-check', t('media.brief.setupTitle', 'Set it up'), brief.setup, true)}

                {/* Camera + light */}
                <div className="brief-info-cards">
                  <div className="brief-info-card">
                    <h5><i className="fa-solid fa-camera"></i> {t('media.brief.cameraTitle', 'Camera')}</h5>
                    {brief.camera && typeof brief.camera === 'object' && !Array.isArray(brief.camera) ? (
                      <ul className="info-kv-list">
                        {CAMERA_FIELDS.filter(([k]) => brief.camera[k]).map(([k, label]) => (
                          <li key={k}>
                            <span className="kv-key">{t(`media.camera.${k}`, label)}</span>
                            <span className="kv-value">{asText(brief.camera[k])}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>{asText(brief.camera)}</p>
                    )}
                  </div>
                  <div className="brief-info-card">
                    <h5><i className="fa-solid fa-lightbulb"></i> {t('media.brief.lightingTitle', 'Lighting')}</h5>
                    <p>{asText(brief.lighting)}</p>
                  </div>
                  {brief.composition && (
                    <div className="brief-info-card">
                      <h5><i className="fa-solid fa-crop-simple"></i> {t('media.brief.compositionTitle', 'Composition')}</h5>
                      <p>{asText(brief.composition)}</p>
                    </div>
                  )}
                  {brief.audio && (
                    <div className="brief-info-card">
                      <h5><i className="fa-solid fa-volume-high"></i> {t('media.brief.audioTitle', 'Audio')}</h5>
                      <p>{asText(brief.audio)}</p>
                    </div>
                  )}
                </div>

                {/* Video-only: the timed script */}
                {Array.isArray(brief.script) && brief.script.length > 0 && (
                  block('fa-scroll', t('media.brief.scriptTitle', 'Script'), (
                    <ul className="script-list">
                      {brief.script.map((line, i) => (
                        <li key={i} className="script-line">
                          <span className="script-time">{asText(line.time)}</span>
                          <span className="script-body">
                            {line.spoken && <span className="script-spoken">“{asText(line.spoken)}”</span>}
                            {line.onScreenText && (
                              <span className="script-onscreen">
                                <i className="fa-solid fa-closed-captioning"></i> {asText(line.onScreenText)}
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ))
                )}
                {/* Older saved briefs stored the script as one paragraph. */}
                {typeof brief.script === 'string' && textBlock('fa-scroll', t('media.brief.scriptTitle', 'Script'), brief.script)}

                {/* The shot list */}
                {Array.isArray(brief.shotList) && brief.shotList.length > 0 && (
                  block('fa-clapperboard', t('media.brief.shotListTitle', 'Shot list'), (
                    <ol className="shot-list">{brief.shotList.map(renderShot)}</ol>
                  ))
                )}

                {listBlock('fa-film', t('media.brief.bRollTitle', 'B-roll to grab'), brief.bRoll, false)}
                {listBlock('fa-scissors', t('media.brief.transitionsTitle', 'Transitions'), brief.transitions, false)}
                {textBlock('fa-sliders', t('media.brief.postTitle', 'After the shoot'), brief.postProcessing)}
                {listBlock('fa-wand-sparkles', t('media.brief.tipsTitle', 'Pro tips'), brief.tips, false)}
              </div>
            )}
          </div>

          {/* UPLOAD + EDIT PLAN — only relevant once you have actually filmed. */}
          <div className="media-work-grid">
            <div className="media-upload-panel glass-card">
              <h3>{t('media.upload.title', 'Upload your footage')}</h3>
              <p className="media-panel-subtitle">{t('media.upload.subtitle', 'Drop in the photo or video you filmed')}</p>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/webm"
                style={{ display: 'none' }}
                onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
              />

              <div
                className={`media-dropzone ${dragOver ? 'dragover' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
              >
                <i className="fa-solid fa-cloud-arrow-up dropzone-icon"></i>
                <p>{t('media.upload.dropHint', 'Drag & drop a file here, or browse')}</p>
                <small className="text-muted">{t('media.upload.formats', 'Images, MP4 or WebM — up to 8MB')}</small>
                <button
                  type="button"
                  className="btn btn-secondary"
                  id="btn_media_upload"
                  disabled={uploading}
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                >
                  <i className="fa-solid fa-folder-open"></i>{' '}
                  {uploading ? t('media.upload.uploading', 'Uploading...') : t('media.upload.browseCta', 'Choose file')}
                </button>
              </div>

              {uploaded && (
                <div className="media-upload-preview animate-fade-in">
                  {uploaded.isVideo ? (
                    <div className="media-video-card">
                      <i className="fa-solid fa-film"></i>
                      <div>
                        <strong>{uploaded.filename}</strong>
                        <small>{t('media.upload.videoReady', 'Video uploaded — ready for an edit plan')}</small>
                      </div>
                    </div>
                  ) : (
                    <img src={mediaUrl} alt={uploaded.filename} />
                  )}
                </div>
              )}
            </div>

            {uploaded ? (
              <div className="media-edit-panel glass-card">
                <h3>{t('media.edit.title', 'AI edit plan')}</h3>
                <p className="media-panel-subtitle">{t('media.edit.subtitle', 'Describe how the AI should edit this media')}</p>

                <form onSubmit={handleEditPlan}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="inp_media_instructions">{t('media.edit.instructionsLabel', 'Editing instructions')}</label>
                    <textarea
                      id="inp_media_instructions"
                      className="input-field media-textarea"
                      rows="3"
                      placeholder={t('media.edit.instructionsPlaceholder', 'e.g. Make it punchy: tight crop, warm tones, bold subtitles, trending audio')}
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      required
                    ></textarea>
                  </div>
                  <button type="submit" className="btn btn-accent w-full" disabled={planning || !instructions.trim()} id="btn_media_edit">
                    {planning
                      ? <><i className="fa-solid fa-spinner fa-spin"></i> {t('media.edit.generating', 'Planning the edit...')}</>
                      : t('media.edit.generateCta', 'Create edit plan')}
                  </button>
                </form>

                {plan && (
                  <div className="plan-output animate-fade-in">
                    {Array.isArray(plan.steps) && plan.steps.length > 0 && (
                      <div className="brief-block">
                        <h4><i className="fa-solid fa-list-check"></i> {t('media.edit.stepsTitle', 'Edit steps')}</h4>
                        <ol className="media-numbered-list">
                          {plan.steps.map((step, i) => <li key={i}>{asText(step)}</li>)}
                        </ol>
                      </div>
                    )}

                    {planDetails.length > 0 && (
                      <div className="plan-detail-grid">
                        {planDetails.map(([key, label]) => (
                          <div key={key} className="plan-detail">
                            <span className="plan-detail-label">{label}</span>
                            <span className="plan-detail-value">{asText(plan[key])}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {plan.exportSpec && (
                      <div className="export-spec">
                        <h5><i className="fa-solid fa-file-export"></i> {t('media.edit.exportTitle', 'Export spec')}</h5>
                        {typeof plan.exportSpec === 'object' && !Array.isArray(plan.exportSpec) ? (
                          <ul className="info-kv-list">
                            {Object.entries(plan.exportSpec).map(([key, value]) => (
                              <li key={key}>
                                <span className="kv-key">{key}</span>
                                <span className="kv-value">{asText(value)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>{asText(plan.exportSpec)}</p>
                        )}
                      </div>
                    )}

                    {engineNote(plan.note || enginePendingText)}
                  </div>
                )}
              </div>
            ) : (
              <div className="media-edit-panel media-edit-locked glass-card">
                <i className="fa-solid fa-scissors"></i>
                <p>{t('media.edit.locked', 'Upload media to unlock AI edit planning.')}</p>
              </div>
            )}
          </div>

          {/* AI PHOTO ENHANCEMENT — what the footage looks like after the AI pass. */}
          <div className="enhancer-box glass-card">
            <h3>{t('content.enhancer.title', 'AI Photo Enhancement')}</h3>
            <p className="media-panel-subtitle">
              {t('content.enhancer.subtitle', 'Upload smartphone photos and let our AI optimize brightness, textures & contrast')}
            </p>

            <div
              className="before-after-container"
              onMouseMove={handleSliderMove}
              onTouchMove={(e) => { if (e.touches[0]) handleSliderMove(e.touches[0]); }}
            >
              {/* Enhanced frame underneath */}
              <div
                className="image-after"
                style={{ backgroundImage: `url('${enhancerImage}')` }}
              >
                <span className="image-label label-after">{t('content.enhancer.afterLabel', 'Enhanced AI Frame')}</span>
              </div>

              {/* Raw frame clipped to the wiper position */}
              <div
                className="image-before"
                style={{
                  backgroundImage: `url('${enhancerImage}')`,
                  clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)`,
                }}
              >
                <span className="image-label label-before">{t('content.enhancer.beforeLabel', 'Raw Phone Photo')}</span>
              </div>

              <div className="slider-divider" style={{ left: `${sliderPosition}%` }}>
                <div className="slider-handle">
                  <i className="fa-solid fa-arrows-left-right"></i>
                </div>
              </div>
            </div>
            <p className="text-center text-muted mt-10">
              <i className="fa-solid fa-circle-info"></i>{' '}
              {t('content.enhancer.hint', 'Hover or drag across the frame to preview raw smartphone vs. AI optimized results')}
            </p>
          </div>
        </>
      )}

      {/* LIBRARY */}
      <div className="media-library glass-card">
        <h3>{t('media.library.title', 'Your media')}</h3>
        {items.length === 0 ? (
          <p className="media-library-empty text-muted">
            {t('media.library.empty', 'Nothing here yet — generate a brief or upload media to get started.')}
          </p>
        ) : (
          <div className="media-library-strip">
            {items.map((item) => (
              <div key={item.id} className="media-library-item">
                <div className="media-library-item-head">
                  <i className={`fa-solid ${item.kind === 'video' ? 'fa-video' : 'fa-image'}`}></i>
                  <span className={`media-status-chip ${item.status}`}>{statusLabels[item.status] || item.status}</span>
                </div>
                <span className="media-library-topic">{item.topic}</span>
                {renders[item.id]?.url && (
                  <img
                    className="media-library-thumb animate-fade-in"
                    src={toAbsolute(renders[item.id].url)}
                    alt={t('media.render.resultAltNamed', { defaultValue: 'Rendered image: {{topic}}', topic: item.topic })}
                  />
                )}
                {renders[item.id]?.notice && engineNote(renders[item.id].notice)}
                {item.mode === 'full' && (item.status === 'brief' || item.status === 'failed') && !renders[item.id]?.url && (
                  <button
                    type="button"
                    className="btn btn-secondary media-item-render-btn"
                    disabled={renderingId !== null}
                    onClick={() => handleRender(item.id)}
                  >
                    <i className={`fa-solid ${renderingId === item.id ? 'fa-spinner fa-spin' : 'fa-image'}`}></i>{' '}
                    {renderingId === item.id
                      ? t('media.render.rendering', 'Rendering image...')
                      : t('media.render.cta', 'Render image')}
                  </button>
                )}
                {item.created_at && (
                  <small className="media-library-date text-muted">{String(item.created_at).slice(0, 10)}</small>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* POST — the end of the page, once there is a finished photo/video to
          send. Everything above this point produces the media; this ships it. */}
      {postable && (
        <div className="media-post-bar glass-card animate-fade-in">
          <div className="media-post-bar-info">
            {postable.kind === 'video'
              ? <i className="fa-solid fa-film media-post-bar-icon"></i>
              : <img src={toAbsolute(postable.url)} alt="" className="media-post-bar-thumb" />}
            <div>
              <strong>{t('media.post.ready', 'Your media is ready')}</strong>
              <p className="text-muted">{t('media.post.readyHint', 'Send it to your connected channels — now or on a schedule.')}</p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => setPublishOpen(true)}
            id="btn_media_post"
          >
            <i className="fa-solid fa-paper-plane"></i> {t('media.post.cta', 'Post')}
          </button>
        </div>
      )}

      {publishOpen && postable && (
        <PublishModal
          media={postable}
          defaultCaption={postCaption}
          onClose={() => setPublishOpen(false)}
          onPosted={loadLibrary}
        />
      )}
    </div>
  );
}
