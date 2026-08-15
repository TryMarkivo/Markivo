import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
// The upload dropzone, variant grid and preview canvas are the onboarding
// designer's, moved here wholesale — so are its styles.
import './Onboarding.css';

// The whole profile (logo data URL included) goes through PUT /api/profile,
// which is behind a 1MB JSON body parser. Base64 inflates bytes ~33%, so we cap
// the ENCODED data URL — not the raw file — leaving room for the rest of the
// body. Oversized uploads are rejected up front instead of failing the save.
const MAX_LOGO_DATAURL = 700 * 1024; // ~700KB encoded

/**
 * Logo, moved out of signup.
 *
 * Registration no longer asks for one — a new owner should reach the product in
 * two screens, and inventing a mark for them (the old Path A coffee cup) was
 * never honest. Here they can upload theirs or generate one, whenever they want
 * to, and until then the dashboard shows a plain initial.
 */
export default function LogoPicker({ activeProfile, onProfileUpdate }) {
  const { t } = useTranslation();

  const current = activeProfile.logo || activeProfile.logoMetadata || null;
  const [logo, setLogo] = useState(current);
  const [variants, setVariants] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const dirty = JSON.stringify(logo || null) !== JSON.stringify(current || null);

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      const data = await api.post('/api/onboarding/logos', {
        businessName: activeProfile.businessName,
        category: activeProfile.category,
        tone: activeProfile.brandTone,
      });
      setVariants(data.logos || data.variants || []);
      setSelectedIdx(null);
    } catch (err) {
      setError(err.message);
    }
    setGenerating(false);
  };

  const handleSelectVariant = (variant, idx) => {
    setSaved(false);
    setSelectedIdx(idx);
    setLogo({
      text: activeProfile.businessName,
      svg: variant.svg,
      color: variant.palette?.accent,
      bgColor: variant.palette?.bg,
      image: undefined,
    });
  };

  // Read an uploaded logo into a compact data URL. Raster images are downscaled
  // (re-scaling smaller if still too large); SVGs are kept as-is when small
  // enough (rendered inside an <img>, so scripts in the SVG cannot run).
  const handleUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file after an error
    if (!file) return;
    setError('');
    setSaved(false);

    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!allowed.includes(file.type)) {
      setError(t('onboarding.pathB.uploadTypeError', 'Please upload a PNG, JPG, SVG, or WebP image.'));
      return;
    }
    if (file.size > 1024 * 1024) {
      setError(t('onboarding.pathB.uploadSizeError', 'Image must be under 1MB.'));
      return;
    }

    const tooBig = () => setError(t('onboarding.pathB.uploadSizeError', 'Image must be under 1MB.'));
    const apply = (image) => {
      setLogo({ text: activeProfile.businessName, image, svg: undefined });
      setSelectedIdx(null);
    };

    const reader = new FileReader();
    reader.onload = () => {
      if (file.type === 'image/svg+xml') {
        if ((reader.result || '').length > MAX_LOGO_DATAURL) return tooBig();
        apply(reader.result);
        return;
      }
      const img = new Image();
      img.onload = () => {
        for (const maxDim of [512, 384, 256, 160]) {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const url = canvas.toDataURL('image/png');
          if (url.length <= MAX_LOGO_DATAURL) return apply(url);
        }
        tooBig();
      };
      img.onerror = () => setError(t('onboarding.pathB.uploadTypeError', 'Please upload a PNG, JPG, SVG, or WebP image.'));
      img.src = reader.result;
    };
    reader.onerror = () => setError(t('onboarding.pathB.uploadTypeError', 'Please upload a PNG, JPG, SVG, or WebP image.'));
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api.put('/api/profile', { logo });
      onProfileUpdate?.(data.profile);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  const previewSrc = logo?.image
    ? logo.image
    : logo?.svg
      ? 'data:image/svg+xml;utf8,' + encodeURIComponent(logo.svg)
      : '';

  return (
    <section className="settings-section glass-card logo-picker" id="logo_picker">
      <h3 className="completion-title">{t('settings.logoTitle', 'Your logo')}</h3>
      <p className="settings-hint">
        {t('settings.logoHint', 'Optional. Upload the mark you already use, or have one designed from your name and tone.')}
      </p>

      <div className="grid-2 logo-designer-grid">
        <div className="logo-controls">
          <div className="form-group">
            <label className="logo-upload-dropzone" htmlFor="inp_profile_logo_upload">
              <i className="fa-solid fa-cloud-arrow-up"></i>
              <span>{t('onboarding.pathB.uploadCta', 'Choose an image · PNG, JPG, SVG (max 1MB)')}</span>
            </label>
            <input
              type="file"
              id="inp_profile_logo_upload"
              className="visually-hidden-file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={handleUpload}
            />
          </div>

          <button
            type="button"
            className="btn btn-accent btn-sm"
            onClick={handleGenerate}
            disabled={generating || !activeProfile.businessName}
            id="btn_profile_generate_logos"
          >
            {generating
              ? t('common.generating', 'Generating...')
              : variants.length > 0
                ? t('onboarding.logoGen.regenerate', '↻ Regenerate')
                : t('onboarding.logoGen.cta', '✦ Generate logo with AI')}
          </button>

          {variants.length > 0 && (
            <div className="logo-variant-grid">
              {variants.map((l, idx) => (
                <button
                  key={idx}
                  type="button"
                  id={`btn_profile_logo_variant_${idx}`}
                  className={`logo-variant-card ${selectedIdx === idx ? 'selected' : ''}`}
                  style={{ backgroundColor: l.palette?.bg }}
                  onClick={() => handleSelectVariant(l, idx)}
                >
                  <img
                    src={'data:image/svg+xml;utf8,' + encodeURIComponent(l.svg)}
                    alt={t('onboarding.logoGen.variantAlt', { defaultValue: 'Logo variant {{num}}', num: idx + 1 })}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="logo-preview-card glass-card text-center">
          <span className="logo-preview-title">{t('onboarding.pathB.uploadPreviewTitle', 'Your Logo')}</span>
          <div className="logo-canvas-wrap" style={{ backgroundColor: logo?.bgColor || 'transparent' }}>
            {previewSrc ? (
              <img className="logo-canvas-svg" src={previewSrc} alt={activeProfile.businessName} />
            ) : (
              <div className="logo-upload-empty">
                <i className="fa-regular fa-image"></i>
                <small>{t('settings.logoEmpty', 'No logo yet — your dashboard shows your initial instead.')}</small>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <p className="logo-gen-error">{error}</p>}

      <div className="completion-actions">
        <button className="btn btn-primary" onClick={handleSave} disabled={busy || !dirty} id="btn_save_logo">
          {busy ? t('settings.saving', 'Saving…') : t('settings.logoSave', 'Save logo')}
        </button>
        {saved && !dirty && (
          <span className="completion-saved"><i className="fa-solid fa-circle-check"></i> {t('profileQuestions.savedShort', 'Saved!')}</span>
        )}
      </div>
    </section>
  );
}
