import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import './MediaAttach.css';

const MAX_BYTES = 8 * 1024 * 1024; // matches backend MAX_UPLOAD_BYTES
const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/webm';

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });

/**
 * Attach one photo or video to a post or a template.
 *
 * The file is uploaded immediately, because what callers actually need is the
 * server-side media id: Instagram fetches post media from a public URL rather
 * than accepting an upload, so nothing can publish until the file exists on our
 * side. `value` is { id, url, kind } or null; onChange gets the same shape.
 */
export default function MediaAttach({ value, onChange, disabled, hint }) {
  const { t } = useTranslation();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (e) => {
    const file = e.target.files?.[0];
    // Reset so re-picking the SAME file still fires a change event.
    e.target.value = '';
    if (!file) return;

    setError('');
    if (file.size > MAX_BYTES) {
      setError(t('media.attach.tooLarge', 'File is too large — 8MB maximum.'));
      return;
    }

    setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const uploaded = await api.post('/api/media/upload', { filename: file.name, dataUrl });
      onChange({
        id: uploaded.id,
        url: uploaded.url,
        kind: file.type.startsWith('video/') ? 'video' : 'image',
      });
    } catch (err) {
      setError(err.message || t('media.attach.failed', 'Upload failed'));
    }
    setBusy(false);
  };

  return (
    <div className="media-attach">
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        onChange={pick}
        style={{ display: 'none' }}
        id="inp_media_attach"
      />

      {value ? (
        <div className="media-attach-preview">
          {value.kind === 'video'
            ? <video src={api.mediaUrl(value.url)} controls className="media-attach-thumb" />
            : <img src={api.mediaUrl(value.url)} alt={t('media.attach.previewAlt', 'Attached media')} className="media-attach-thumb" />}
          <div className="media-attach-meta">
            <span className="badge badge-primary">
              <i className={`fa-solid ${value.kind === 'video' ? 'fa-video' : 'fa-image'}`}></i>{' '}
              {value.kind === 'video' ? t('media.attach.video', 'Video') : t('media.attach.photo', 'Photo')}
            </span>
            <div className="media-attach-actions">
              <button type="button" className="btn btn-text btn-sm" onClick={() => fileRef.current?.click()} disabled={disabled || busy}>
                {t('media.attach.replace', 'Replace')}
              </button>
              <button type="button" className="btn btn-text btn-sm text-danger" onClick={() => { setError(''); onChange(null); }} disabled={disabled || busy}>
                <i className="fa-solid fa-xmark"></i> {t('media.attach.remove', 'Remove')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-secondary w-full media-attach-cta"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || busy}
          id="btn_attach_media"
        >
          {busy
            ? <><i className="fa-solid fa-spinner fa-spin"></i> {t('media.attach.uploading', 'Uploading…')}</>
            : <><i className="fa-solid fa-paperclip"></i> {t('media.attach.cta', 'Attach photo or video')}</>}
        </button>
      )}

      {hint && !value && <p className="media-attach-hint text-muted">{hint}</p>}
      {error && <div className="auth-error-box mt-10">{error}</div>}
    </div>
  );
}
