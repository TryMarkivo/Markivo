import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import './TemplateStudio.css';

const PREVIEW_MAX_CHARS = 220;
const previewOf = (text) => {
  const s = String(text || '');
  return s.length > PREVIEW_MAX_CHARS ? `${s.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…` : s;
};

/**
 * Saved writing styles — a voice profile learned from a sample post (the
 * owner's own, or copied from a competitor), reusable at generation time.
 * Structurally mirrors TemplateStudio (paste a sample -> analyze -> edit ->
 * save -> saved list), but there is no {{variable}} editing: a style is one
 * plain-text voice description, not a fill-in-the-blank message. Reuses
 * TemplateStudio's CSS — the card/list/draft classes are generic enough to
 * share as-is.
 *
 * `onSaved` (optional) fires after a successful create/edit — AIEditorModal's
 * Style tab uses it to refresh its own chip row. `hideSavedList` (optional)
 * skips the "Saved styles" listing below the editor — AIEditorModal already
 * shows saved styles as chips, so embedding this without it avoids showing
 * the same list twice.
 */
export default function StyleStudio({ onSaved, hideSavedList } = {}) {
  const { t } = useTranslation();

  const [saved, setSaved] = useState([]);
  const [loadingList, setLoadingList] = useState(true);

  const [sample, setSample] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [draft, setDraft] = useState(null); // { id, name, styleSummary, sampleText, source }
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/styles')
      .then((rows) => { if (!cancelled) setSaved(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setSaved([]); })
      .finally(() => { if (!cancelled) setLoadingList(false); });
    return () => { cancelled = true; };
  }, [reloadToken]);

  const patchDraft = (patch) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const handleAnalyze = async () => {
    if (!sample.trim() || analyzing) return;
    setAnalyzing(true);
    setError('');
    try {
      const data = await api.post('/api/styles/analyze', { sample });
      setDraft({
        id: null,
        name: data.name || '',
        styleSummary: data.styleSummary || '',
        sampleText: data.sampleText || sample,
        source: data.source || 'manual',
      });
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setAnalyzing(false);
  };

  // Clone a voice straight from a Telegram Desktop "Export chat history" file
  // (.json or .html — the two formats Telegram produces) instead of hand-
  // pasting a message: read it client-side, send it to the parser, and drop
  // the extracted sample into the same textarea the normal flow already uses.
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file || importing) return;
    const format = file.name.toLowerCase().endsWith('.json') ? 'json' : 'html';
    setImporting(true);
    setError('');
    try {
      const content = await file.text();
      const data = await api.post('/api/styles/import', { format, content });
      setSample(data.sample || '');
      setDraft(null);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setImporting(false);
  };

  const handleEditSaved = (style) => {
    setError('');
    setSample(style.sampleText || '');
    setDraft({
      id: style.id,
      name: style.name || '',
      styleSummary: style.styleSummary || '',
      sampleText: style.sampleText || '',
      source: style.source || 'manual',
    });
  };

  const handleSave = async () => {
    if (!draft || !draft.styleSummary.trim() || saving) return;
    setSaving(true);
    setError('');
    const body = {
      name: draft.name || draft.styleSummary.slice(0, 40),
      sampleText: draft.sampleText,
      styleSummary: draft.styleSummary,
      source: draft.source,
    };
    try {
      if (draft.id) await api.put(`/api/styles/${draft.id}`, body);
      else await api.post('/api/styles', body);
      setDraft(null);
      setSample('');
      refresh();
      onSaved?.();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    try {
      await api.del(`/api/styles/${id}`);
      if (draft && draft.id === id) setDraft(null);
      refresh();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
  };

  return (
    <div className="template-studio glass-card">
      <div className="panel-title-wrap">
        <i className="fa-solid fa-signature text-accent icon-header"></i>
        <div>
          <h3>{t('styles.title', 'Writing Styles')}</h3>
          <p className="text-muted">
            {t('styles.subtitle', "Paste a post — your own, or copied from a competitor — and learn its voice, so you can write new posts that sound like it.")}
          </p>
        </div>
      </div>

      {error && <div className="auth-error-box mt-10" role="alert">{error}</div>}

      {/* --- STEP 1: paste a sample post --- */}
      <div className="form-group mt-20">
        <label className="form-label" htmlFor="inp_style_sample">
          {t('styles.sampleLabel', 'A post whose voice you want to reuse')}
        </label>
        <textarea
          id="inp_style_sample"
          className="input-field text-area"
          rows="4"
          placeholder={t('styles.samplePlaceholder', 'Paste any post here — yours or a competitor\'s. We learn HOW it\'s written, not what it says.')}
          value={sample}
          onChange={(e) => setSample(e.target.value)}
        ></textarea>
        <div className="style-import-row">
          <span className="text-muted template-hint">{t('styles.importLabel', 'Or import a Telegram export')}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            id="btn_import_style_file"
            title={t('styles.importHint', "Upload a .json or .html file from Telegram Desktop's \"Export chat history\" to learn a voice from a whole channel.")}
          >
            <i className={`fa-solid ${importing ? 'fa-spinner fa-spin' : 'fa-file-arrow-up'}`}></i>{' '}
            {importing ? t('styles.importing', 'Reading file…') : t('styles.importCta', 'Import file')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.html,.htm"
            onChange={handleImportFile}
            hidden
            id="inp_style_import_file"
          />
        </div>
      </div>

      <div className="template-actions">
        <button
          className="btn btn-primary"
          onClick={handleAnalyze}
          disabled={analyzing || !sample.trim()}
          id="btn_analyze_style"
        >
          {analyzing
            ? t('styles.analyzing', 'Reading the voice…')
            : t('styles.analyzeCta', 'Analyze style ✦')}
        </button>
      </div>

      {/* --- STEP 2: name it and review the voice description --- */}
      {draft && (
        <div className="template-draft animate-fade-in">
          <div className="template-draft-head">
            <span className="template-draft-mode">
              {draft.id ? t('styles.editingBadge', 'Editing saved style') : t('styles.newBadge', 'New style')}
            </span>
            <input
              className="input-field template-name-input"
              value={draft.name}
              onChange={(e) => patchDraft({ name: e.target.value })}
              placeholder={t('styles.namePlaceholder', 'e.g. Playful & emoji-heavy')}
              aria-label={t('styles.nameLabel', 'Style name')}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="inp_style_summary">{t('styles.summaryLabel', 'Voice description')}</label>
            <textarea
              id="inp_style_summary"
              className="input-field text-area"
              rows="4"
              value={draft.styleSummary}
              onChange={(e) => patchDraft({ styleSummary: e.target.value })}
            ></textarea>
            <p className="template-hint text-muted">
              {t('styles.summaryHint', 'This is used to steer new posts — edit it freely, it never needs to match the sample word for word.')}
            </p>
          </div>

          <div className="template-actions">
            <button className="btn btn-secondary" onClick={() => setDraft(null)}>
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || !draft.styleSummary.trim()}
              id="btn_save_style"
            >
              {saving
                ? t('styles.saving', 'Saving…')
                : draft.id
                  ? t('styles.saveChanges', 'Save changes')
                  : t('styles.saveCta', 'Save style')}
            </button>
          </div>
        </div>
      )}

      {/* --- SAVED STYLES --- */}
      {!hideSavedList && (
      <div className="saved-templates">
        <h4>{t('styles.savedTitle', 'Saved styles')}</h4>
        {loadingList ? (
          <div className="text-center" style={{ padding: 20 }}>
            <i className="fa-solid fa-spinner fa-spin text-accent"></i>
          </div>
        ) : saved.length === 0 ? (
          <p className="text-muted template-hint">
            {t('styles.savedEmpty', 'No saved styles yet.')}
          </p>
        ) : (
          saved.map((style) => (
            <div key={style.id} className="saved-template-card">
              <div className="tpl-card-head">
                <div className="tpl-card-text">
                  <strong>{style.name || t('styles.untitled', 'Untitled style')}</strong>
                  <p className="template-hint text-muted tpl-card-preview">{previewOf(style.styleSummary)}</p>
                </div>
                <div className="tpl-card-actions">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleEditSaved(style)}
                    id={`btn_edit_style_${style.id}`}
                  >
                    <i className="fa-solid fa-pen-to-square"></i> {t('common.edit', 'Edit')}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm tpl-delete-btn"
                    onClick={() => handleDelete(style.id)}
                    aria-label={t('styles.deleteStyle', 'Delete style')}
                    title={t('styles.deleteStyle', 'Delete style')}
                    id={`btn_delete_style_${style.id}`}
                  >
                    <i className="fa-solid fa-trash"></i> {t('common.delete', 'Delete')}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      )}
    </div>
  );
}
