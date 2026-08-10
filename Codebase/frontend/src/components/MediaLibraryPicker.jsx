import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import './MediaLibraryPicker.css';

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
 * Pick media for the post composer: either a fresh upload (same immediate
 * upload-then-attach flow as MediaAttach) or an existing item from the
 * profile's media library (GET /api/media, not previously exposed as a
 * picker anywhere). Resolves to { id, url, kind } either way.
 */
export default function MediaLibraryPicker({ onSelect, onClose }) {
  const { t } = useTranslation();
  const fileRef = useRef(null);
  const [tab, setTab] = useState('library'); // 'library' | 'upload'
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/media')
      .then((data) => setItems((data.items || []).filter((i) => i.filePath)))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
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
      onSelect({ id: uploaded.id, url: uploaded.url, kind: file.type.startsWith('video/') ? 'video' : 'image' });
      onClose?.();
    } catch (err) {
      setError(err.message || t('media.attach.failed', 'Upload failed'));
    }
    setBusy(false);
  };

  const pickLibraryItem = (item) => {
    onSelect({ id: item.id, url: item.filePath, kind: item.kind });
    onClose?.();
  };

  return (
    <div
      className="auth-overlay animate-fade-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}
    >
      <div className="auth-card glass-card glass-card-glow text-left mlp-card" role="dialog" aria-modal="true" aria-labelledby="mlp_title">
        <div className="auth-header flex-between mb-20">
          <h3 id="mlp_title"><i className="fa-solid fa-photo-film"></i> {t('media.picker.title', 'Insert media')}</h3>
          <button className="btn-close" onClick={onClose} disabled={busy} id="btn_close_mlp" aria-label={t('common.close', 'Close')}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {error && <div className="auth-error-box mb-20" role="alert">{error}</div>}

        <div className="mlp-tabs">
          <button type="button" className={`mlp-tab ${tab === 'library' ? 'active' : ''}`} onClick={() => setTab('library')} id="btn_mlp_tab_library">
            <i className="fa-solid fa-images"></i> {t('media.picker.library', 'Library')}
          </button>
          <button type="button" className={`mlp-tab ${tab === 'upload' ? 'active' : ''}`} onClick={() => setTab('upload')} id="btn_mlp_tab_upload">
            <i className="fa-solid fa-upload"></i> {t('media.picker.upload', 'Upload new')}
          </button>
        </div>

        {tab === 'upload' ? (
          <div className="mlp-upload">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              onChange={pickFile}
              style={{ display: 'none' }}
              id="inp_mlp_upload"
            />
            <button
              type="button"
              className="btn btn-secondary w-full media-attach-cta"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              id="btn_mlp_upload_cta"
            >
              {busy
                ? <><i className="fa-solid fa-spinner fa-spin"></i> {t('media.attach.uploading', 'Uploading…')}</>
                : <><i className="fa-solid fa-paperclip"></i> {t('media.attach.cta', 'Attach photo or video')}</>}
            </button>
          </div>
        ) : items === null ? (
          <div className="text-center" style={{ padding: 30 }}><i className="fa-solid fa-spinner fa-spin fa-2x text-accent"></i></div>
        ) : items.length === 0 ? (
          <p className="text-muted mlp-empty">
            {t('media.picker.empty', 'Nothing in your library yet — switch to Upload new.')}
          </p>
        ) : (
          <div className="mlp-grid">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="mlp-item"
                onClick={() => pickLibraryItem(item)}
                disabled={busy}
                id={`btn_mlp_item_${item.id}`}
              >
                {item.kind === 'video' ? (
                  <video src={api.mediaUrl(item.filePath)} className="mlp-thumb" muted />
                ) : (
                  <img src={api.mediaUrl(item.filePath)} alt={item.topic || ''} className="mlp-thumb" />
                )}
                <span className="mlp-item-kind"><i className={`fa-solid ${item.kind === 'video' ? 'fa-video' : 'fa-image'}`}></i></span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
