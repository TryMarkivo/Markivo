import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import './MediaStudio.css';

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB client-side cap

// Defensive stringifier: backend fields may arrive as strings, arrays or objects.
function asText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(asText).join(', ');
  if (typeof value === 'object') return Object.values(value).map(asText).join(' · ');
  return String(value);
}

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

  const loadLibrary = useCallback(() => {
    api.get('/api/media')
      .then((data) => setItems(data.items || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  const handleBrief = async (e) => {
    e.preventDefault();
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
      loadLibrary();
    } catch (err) {
      setError(err.message);
    }
    setBriefLoading(false);
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

  const handleRender = async (id) => {
    if (!id || renderingId) return;
    setRenderingId(id);
    setError(null);
    try {
      const data = await api.post(`/api/media/${id}/render`, {});
      setRenders((prev) => ({ ...prev, [id]: { url: data.url } }));
      loadLibrary();
    } catch (err) {
      if (err.status === 501) {
        // Engine keyless / unsupported kind — show the amber notice with the server's message.
        setRenders((prev) => ({ ...prev, [id]: { notice: err.message } }));
      } else {
        setError(err.message);
      }
    }
    setRenderingId(null);
  };

  const toAbsolute = (url) => (url?.startsWith('http') ? url : api.base + url);

  const mediaUrl = uploaded ? toAbsolute(uploaded.url) : null;

  const statusLabels = {
    brief: t('media.status.brief', 'Brief'),
    uploaded: t('media.status.uploaded', 'Uploaded'),
    edit_plan: t('media.status.edit_plan', 'Edit plan'),
    rendered: t('media.status.rendered', 'Rendered'),
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

      {/* 1. MODE CHOOSER */}
      <div className="media-mode-grid">
        <button
          type="button"
          className={`media-mode-card glass-card ${mode === 'full' ? 'active' : ''}`}
          onClick={() => setMode('full')}
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
          onClick={() => setMode('guided')}
          id="btn_mode_guided"
        >
          <div className="mode-icon"><i className="fa-solid fa-camera"></i></div>
          <div className="mode-copy">
            <h4>{t('media.modes.guidedTitle', 'Guided shoot')}</h4>
            <p>{t('media.modes.guidedDesc', 'AI writes your full shooting plan — you film, AI edits')}</p>
          </div>
        </button>
      </div>

      {/* 2 + 3. KIND TOGGLE, TOPIC INPUT, BRIEF OUTPUT */}
      <div className="media-brief-panel glass-card">
        <h3>{t('media.brief.title', 'Creative brief')}</h3>
        <p className="media-panel-subtitle">{t('media.brief.subtitle', 'Tell the AI what this media should be about')}</p>

        <form onSubmit={handleBrief}>
          <div className="form-group">
            <label className="form-label">{t('media.brief.kindLabel', 'Media type')}</label>
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
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="inp_media_topic">{t('media.brief.topicLabel', 'Topic')}</label>
            <input
              id="inp_media_topic"
              type="text"
              className="input-field"
              placeholder={t('media.brief.topicPlaceholder', 'e.g. New seasonal latte menu launching this Friday')}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn btn-primary w-full" disabled={briefLoading || !topic.trim()} id="btn_media_brief">
            {briefLoading
              ? <><i className="fa-solid fa-spinner fa-spin"></i> {t('media.brief.generating', 'Writing your brief...')}</>
              : t('media.brief.generateCta', 'Generate brief')}
          </button>
        </form>

        {/* GUIDED BRIEF */}
        {brief && briefMode === 'guided' && (
          <div className="brief-output animate-fade-in">
            <div className="brief-block">
              <h4><i className="fa-solid fa-scroll"></i> {t('media.brief.scriptTitle', 'Script')}</h4>
              <p className="brief-script">{asText(brief.script)}</p>
            </div>

            {Array.isArray(brief.shotList) && brief.shotList.length > 0 && (
              <div className="brief-block">
                <h4><i className="fa-solid fa-clapperboard"></i> {t('media.brief.shotListTitle', 'Shot list')}</h4>
                <ol className="media-numbered-list">
                  {brief.shotList.map((shot, i) => <li key={i}>{asText(shot)}</li>)}
                </ol>
              </div>
            )}

            <div className="brief-info-cards">
              <div className="brief-info-card">
                <h5><i className="fa-solid fa-camera"></i> {t('media.brief.cameraTitle', 'Camera')}</h5>
                {brief.camera && typeof brief.camera === 'object' && !Array.isArray(brief.camera) ? (
                  <ul className="info-kv-list">
                    {Object.entries(brief.camera).map(([key, value]) => (
                      <li key={key}>
                        <span className="kv-key">{key}</span>
                        <span className="kv-value">{asText(value)}</span>
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
              <div className="brief-info-card">
                <h5><i className="fa-solid fa-volume-high"></i> {t('media.brief.audioTitle', 'Audio')}</h5>
                <p>{asText(brief.audio)}</p>
              </div>
            </div>

            {Array.isArray(brief.tips) && brief.tips.length > 0 && (
              <div className="brief-block">
                <h4><i className="fa-solid fa-wand-sparkles"></i> {t('media.brief.tipsTitle', 'Pro tips')}</h4>
                <ul className="brief-tips">
                  {brief.tips.map((tip, i) => (
                    <li key={i}><i className="fa-solid fa-circle-check"></i> <span>{asText(tip)}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* FULL AI BRIEF */}
        {brief && briefMode === 'full' && (
          <div className="brief-output animate-fade-in">
            <div className="brief-block">
              <h4><i className="fa-solid fa-lightbulb"></i> {t('media.brief.conceptTitle', 'Concept')}</h4>
              <p className="brief-script">{asText(brief.concept)}</p>
            </div>

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

            {briefKind === 'image' ? (
              <div className="media-render-section">
                {renders[briefId]?.url ? (
                  <div className="render-result animate-fade-in">
                    <div className="render-success-note">
                      <i className="fa-solid fa-circle-check"></i>
                      <span>{t('media.render.success', 'Image rendered — ready to use in your posts.')}</span>
                    </div>
                    <img src={toAbsolute(renders[briefId].url)} alt={t('media.render.resultAltNamed', { defaultValue: 'Rendered image: {{topic}}', topic })} />
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
                      <i className={`fa-solid ${renderingId === briefId ? 'fa-spinner fa-spin' : 'fa-image'}`}></i>{' '}
                      {renderingId === briefId
                        ? t('media.render.rendering', 'Rendering image...')
                        : t('media.render.cta', 'Render image')}
                    </button>
                  </>
                )}
              </div>
            ) : (
              engineNote(brief.note || enginePendingText)
            )}
          </div>
        )}
      </div>

      {/* 4 + 5. UPLOAD + EDIT PLAN */}
      <div className="media-work-grid">

        {/* UPLOAD PANEL */}
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

        {/* EDIT PLAN PANEL */}
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

      {/* 6. LIBRARY */}
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
                {item.mode === 'full' && item.kind === 'image' && item.status === 'brief' && !renders[item.id]?.url && (
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
    </div>
  );
}
