import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import './Onboarding.css';

const MAX_BYTES = 8 * 1024 * 1024; // matches backend MAX_UPLOAD_BYTES
const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/webm';
const CAPTION_MAX = 2200;

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });

/**
 * Compose and publish a real Instagram post (image or video/Reel). Uploads the
 * selected file to the backend (which exposes it at a public URL the Instagram
 * Graph API can fetch), then publishes with the caption.
 */
export default function InstagramComposer({ status, onPosted, onClose }) {
  const { t } = useTranslation();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState('');           // '' | 'uploading' | 'publishing'
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);     // { permalink }

  const isVideo = file?.type?.startsWith('video/');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  // Revoke the object URL when the preview changes/unmounts.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const pickFile = (e) => {
    setError('');
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setError(t('instagram.composer.tooLarge', 'File is too large — 8MB maximum.'));
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const publish = async () => {
    if (!file) return;
    setError('');
    try {
      setBusy('uploading');
      const dataUrl = await readAsDataUrl(file);
      const uploaded = await api.post('/api/media/upload', { filename: file.name, dataUrl });

      setBusy('publishing');
      const res = await api.post('/api/instagram/post', { mediaId: uploaded.id, caption: caption.trim() });
      setResult({ permalink: res.permalink });
      onPosted?.();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    } finally {
      setBusy('');
    }
  };

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl('');
    setCaption('');
    setResult(null);
    setError('');
  };

  const handle = status?.username ? `@${status.username}` : t('instagram.yourAccount', 'your account');

  return (
    <div
      className="auth-overlay animate-fade-in"
      id="instagram_composer_modal"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}
    >
      <div className="auth-card glass-card glass-card-glow text-left" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-labelledby="instagram_composer_title">
        <div className="auth-header flex-between mb-20">
          <h3 id="instagram_composer_title">
            <i className="fa-brands fa-instagram" style={{ color: '#E1306C' }}></i> {t('instagram.composer.title', 'New Instagram post')}
          </h3>
          <button className="btn-close" onClick={onClose} id="btn_close_ig_composer" disabled={!!busy} aria-label={t('common.close', 'Close')}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {error && <div className="auth-error-box mb-20" role="alert">{error}</div>}

        {result ? (
          <div className="step-content text-center">
            <i className="fa-solid fa-circle-check fa-3x text-success mb-20" style={{ display: 'block' }}></i>
            <h4>{t('instagram.composer.publishedTitle', 'Published to Instagram!')}</h4>
            <p className="mt-10 text-muted">{t('instagram.composer.publishedTo', { defaultValue: 'Posted to {{handle}}.', handle })}</p>
            {result.permalink && (
              <p className="mt-10">
                <a className="link-text" href={result.permalink} target="_blank" rel="noreferrer">
                  {t('instagram.composer.viewPost', 'View post on Instagram ↗')}
                </a>
              </p>
            )}
            <div className="flex-gap-8 mt-20" style={{ justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={reset} id="btn_ig_post_another">{t('instagram.composer.another', 'Post another')}</button>
              <button className="btn btn-primary" onClick={onClose} id="btn_ig_composer_done">{t('common.done', 'Done')}</button>
            </div>
          </div>
        ) : (
          <div className="step-content">
            <p className="text-muted mb-20" style={{ fontSize: 13 }}>
              <i className="fa-solid fa-circle-info"></i>{' '}
              {t('instagram.composer.hint', 'Posts to {{handle}}. Instagram requires media — use a JPEG image or an MP4 video (Reel). Max 8MB.', { handle })}
            </p>

            <input ref={fileRef} type="file" accept={ACCEPT} onChange={pickFile} style={{ display: 'none' }} id="inp_ig_file" />

            {!previewUrl ? (
              <button className="btn btn-secondary w-full mb-20" onClick={() => fileRef.current?.click()} disabled={!!busy} id="btn_ig_pick">
                <i className="fa-solid fa-image"></i> {t('instagram.composer.pick', 'Choose image or video')}
              </button>
            ) : (
              <div className="mb-20" style={{ textAlign: 'center' }}>
                {isVideo
                  ? <video src={previewUrl} controls style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 8 }} />
                  : <img src={previewUrl} alt="preview" style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 8 }} />}
                <div className="mt-10">
                  <button className="btn btn-text" onClick={() => fileRef.current?.click()} disabled={!!busy} id="btn_ig_change">
                    {t('instagram.composer.change', 'Change file')}
                  </button>
                </div>
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="inp_ig_caption">{t('instagram.composer.caption', 'Caption')}</label>
              <textarea
                id="inp_ig_caption"
                className="input-field"
                rows={4}
                maxLength={CAPTION_MAX}
                placeholder={t('instagram.composer.captionPh', 'Write a caption… #hashtags welcome')}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                disabled={!!busy}
              />
              <div className="text-muted" style={{ fontSize: 12, textAlign: 'right' }}>{caption.length}/{CAPTION_MAX}</div>
            </div>

            <button className="btn btn-primary w-full" onClick={publish} disabled={!file || !!busy} id="btn_ig_publish">
              {busy === 'uploading'
                ? t('instagram.composer.uploading', 'Uploading…')
                : busy === 'publishing'
                  ? (isVideo ? t('instagram.composer.publishingVideo', 'Publishing… (video can take a minute)') : t('instagram.composer.publishing', 'Publishing…'))
                  : t('instagram.composer.publish', 'Publish to Instagram ✦')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

