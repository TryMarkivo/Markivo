import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import StyleStudio from './StyleStudio';
import TemplateStudio from './TemplateStudio';
import './AIEditorModal.css';

const TABS = ['translate', 'style', 'fix', 'templates'];
const TRANSLATE_LANGUAGES = ['English', 'Uzbek', 'Russian', 'Turkish', 'Arabic', 'Spanish'];

// Shared Original/Result view used by Translate, Style, and Fix — Telegram's
// AI Editor pattern: a collapsible Original, an editable Result, a copy
// button, and an Apply action that hands the result back to the composer.
function OriginalResult({ t, original, result, setResultText, busy, applyLabel, onApply, extra }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!result) return;
    navigator.clipboard?.writeText(result.text || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="aie-result-wrap animate-fade-in">
      <button type="button" className="aie-original-toggle" onClick={() => setShowOriginal((v) => !v)}>
        <i className={`fa-solid fa-chevron-${showOriginal ? 'down' : 'right'}`}></i> {t('aiEditor.original', 'Original')}
      </button>
      {showOriginal && <p className="aie-original-text text-muted">{original}</p>}

      <div className="aie-result-head">
        <span className="aie-result-label">{t('aiEditor.result', 'Result')}</span>
        {extra}
        <button type="button" className="aie-copy-btn" onClick={copy} disabled={!result} id="btn_aie_copy_result">
          <i className={`fa-solid ${copied ? 'fa-check' : 'fa-copy'}`}></i> {copied ? t('aiEditor.copied', 'Copied!') : t('aiEditor.copy', 'Copy')}
        </button>
      </div>
      <textarea
        className="input-field text-area aie-result-textarea"
        rows={5}
        value={result ? result.text : ''}
        onChange={(e) => setResultText(e.target.value)}
        disabled={busy || !result}
        placeholder={busy ? '…' : ''}
        id="inp_aie_result"
      ></textarea>
      {result?.source === 'unavailable' && (
        <p className="aie-notice text-muted">{t('aiEditor.unavailableNotice', "AI isn't configured yet, so this is the original text unchanged — connect a Gemini key to enable this.")}</p>
      )}
      <div className="template-actions">
        <button className="btn btn-primary" onClick={onApply} disabled={!result || busy} id="btn_aie_apply">
          {applyLabel}
        </button>
      </div>
    </div>
  );
}

function TranslateTab({ t, text, onApply }) {
  const [language, setLanguage] = useState('');
  const [custom, setCustom] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const targetLanguage = language === 'other' ? custom.trim() : language;

  const pickLanguage = (lang) => {
    setLanguage(lang);
    setResult(null);
    setError('');
  };

  const run = async () => {
    if (!text.trim() || !targetLanguage || busy) return;
    setBusy(true);
    setError('');
    try {
      setResult(await api.post('/api/content/translate', { text, targetLanguage }));
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setBusy(false);
  };

  return (
    <div className="aie-tab-body">
      {!text.trim() && <p className="text-muted">{t('aiEditor.nothingToEdit', 'Write something in the composer first.')}</p>}

      <span className="aie-chip-section-title">{t('aiEditor.translateLanguageLabel', 'Translate into')}</span>
      <div className="aie-chip-row">
        {TRANSLATE_LANGUAGES.map((lang) => (
          <button key={lang} type="button" className={`aie-chip ${language === lang ? 'active' : ''}`} onClick={() => pickLanguage(lang)} disabled={!text.trim()}>
            {lang}
          </button>
        ))}
        <button type="button" className={`aie-chip ${language === 'other' ? 'active' : ''}`} onClick={() => pickLanguage('other')} disabled={!text.trim()}>
          {t('common.other', 'Other')}
        </button>
      </div>
      {language === 'other' && (
        <input
          className="input-field mt-10"
          value={custom}
          onChange={(e) => { setCustom(e.target.value); setResult(null); }}
          placeholder={t('aiEditor.translateOtherPlaceholder', 'Type a language…')}
          id="inp_aie_custom_language"
        />
      )}

      {error && <div className="auth-error-box mt-10" role="alert">{error}</div>}

      <div className="template-actions mt-10">
        <button className="btn btn-secondary" onClick={run} disabled={busy || !text.trim() || !targetLanguage} id="btn_aie_translate">
          {busy ? t('aiEditor.translating', 'Translating…') : t('aiEditor.translateCta', 'Translate')}
        </button>
      </div>

      {(result || busy) && (
        <OriginalResult
          t={t} original={text} result={result} busy={busy}
          setResultText={(v) => setResult((r) => ({ ...r, text: v }))}
          applyLabel={t('aiEditor.applyTranslation', 'Apply Translation')}
          onApply={() => onApply(result.text)}
        />
      )}
    </div>
  );
}

function FixTab({ t, text, onApply }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      setResult(await api.post('/api/content/fix', { text }));
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setBusy(false);
  };

  return (
    <div className="aie-tab-body">
      {!text.trim() ? (
        <p className="text-muted">{t('aiEditor.nothingToEdit', 'Write something in the composer first.')}</p>
      ) : (
        <p className="text-muted template-hint">{t('aiEditor.fixIntro', 'Fixes grammar, spelling, and punctuation — nothing else changes.')}</p>
      )}

      {error && <div className="auth-error-box mt-10" role="alert">{error}</div>}

      <div className="template-actions">
        <button className="btn btn-secondary" onClick={run} disabled={busy || !text.trim()} id="btn_aie_fix">
          {busy ? t('aiEditor.fixing', 'Fixing…') : t('aiEditor.fixCta', 'Fix it ✦')}
        </button>
      </div>

      {(result || busy) && (
        <OriginalResult
          t={t} original={text} result={result} busy={busy}
          setResultText={(v) => setResult((r) => ({ ...r, text: v }))}
          applyLabel={t('aiEditor.applyFix', 'Apply Fix')}
          onApply={() => onApply(result.text)}
        />
      )}
    </div>
  );
}

function StyleTab({ t, text, onApply }) {
  const [presets, setPresets] = useState([]);
  const [savedStyles, setSavedStyles] = useState([]);
  const [selected, setSelected] = useState(null); // { presetKey } | { styleId }
  const [emojify, setEmojify] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const loadSavedStyles = () =>
    api.get('/api/styles').then((rows) => setSavedStyles(Array.isArray(rows) ? rows : [])).catch(() => {});

  useEffect(() => {
    api.get('/api/styles/presets').then((rows) => setPresets(Array.isArray(rows) ? rows : [])).catch(() => {});
    loadSavedStyles();
  }, []);

  const run = async (sel, emojifyVal) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const body = { text, emojify: emojifyVal, ...(sel.presetKey ? { presetKey: sel.presetKey } : { styleId: sel.styleId }) };
      setResult(await api.post('/api/styles/apply', body));
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setBusy(false);
  };

  const pick = (sel) => {
    setSelected(sel);
    setResult(null);
    run(sel, emojify);
  };

  const toggleEmojify = () => {
    const next = !emojify;
    setEmojify(next);
    if (selected) run(selected, next);
  };

  return (
    <div className="aie-tab-body">
      {!text.trim() && <p className="text-muted">{t('aiEditor.nothingToEdit', 'Write something in the composer first.')}</p>}

      <div className="aie-chip-section">
        <span className="aie-chip-section-title">{t('aiEditor.stylePresetsTitle', 'Quick styles')}</span>
        <div className="aie-preset-grid">
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`aie-preset-chip ${selected?.presetKey === p.key ? 'active' : ''}`}
              onClick={() => pick({ presetKey: p.key })}
              disabled={!text.trim() || busy}
              id={`btn_aie_preset_${p.key}`}
            >
              <span className="aie-preset-emoji">{p.emoji}</span>
              <span className="aie-preset-label">{p.label}</span>
            </button>
          ))}
        </div>
      </div>

      {savedStyles.length > 0 && (
        <div className="aie-chip-section">
          <span className="aie-chip-section-title">{t('aiEditor.styleYoursTitle', 'Your styles')}</span>
          <div className="aie-preset-grid">
            {savedStyles.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`aie-preset-chip ${selected?.styleId === s.id ? 'active' : ''}`}
                onClick={() => pick({ styleId: s.id })}
                disabled={!text.trim() || busy}
                id={`btn_aie_style_${s.id}`}
              >
                <span className="aie-preset-emoji">✦</span>
                <span className="aie-preset-label">{s.name || t('styles.untitled', 'Untitled style')}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button type="button" className="aie-add-style-toggle" onClick={() => setShowAdd((v) => !v)} id="btn_aie_add_style_toggle">
        <i className={`fa-solid fa-chevron-${showAdd ? 'down' : 'right'}`}></i> {t('aiEditor.styleAddNew', '+ Add a new style')}
      </button>
      {showAdd && (
        <div className="aie-add-style-panel animate-fade-in">
          <StyleStudio hideSavedList onSaved={loadSavedStyles} />
        </div>
      )}

      {error && <div className="auth-error-box mt-10" role="alert">{error}</div>}

      {(result || busy) && (
        <OriginalResult
          t={t} original={text} result={result} busy={busy}
          setResultText={(v) => setResult((r) => ({ ...r, text: v }))}
          applyLabel={t('aiEditor.applyStyle', 'Apply Style')}
          onApply={() => onApply(result.text)}
          extra={
            <label className="aie-emojify-toggle">
              <input type="checkbox" checked={emojify} onChange={toggleEmojify} disabled={busy} />
              {t('aiEditor.emojify', 'emojify')}
            </label>
          }
        />
      )}
    </div>
  );
}

/**
 * Create Post's "AI Editor" — Telegram-style Translate / Style / Fix on
 * whatever text is already in the composer, plus a Templates tab that
 * embeds TemplateStudio verbatim (the former standalone TemplatesModal).
 * `text` is the composer's current active value (see CreatePost#activeValue);
 * `onApply(text, media?)` writes the result back and closes the panel — media
 * is only ever passed by the Templates tab, exactly like the old
 * TemplatesModal#onUseTemplate did.
 */
export default function AIEditorModal({ text, onApply, onClose }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('style');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="auth-overlay animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="aie-card glass-card glass-card-glow text-left" role="dialog" aria-modal="true" aria-labelledby="aie_title">
        <div className="auth-header flex-between mb-20">
          <h3 id="aie_title"><i className="fa-solid fa-wand-magic-sparkles"></i> {t('aiEditor.title', 'AI Editor')}</h3>
          <button className="btn-close" onClick={onClose} id="btn_close_ai_editor" aria-label={t('common.close', 'Close')}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="aie-tab-row" role="tablist">
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`aie-tab ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
              id={`btn_aie_tab_${key}`}
            >
              {t(`aiEditor.tab${key.charAt(0).toUpperCase()}${key.slice(1)}`, key)}
            </button>
          ))}
        </div>

        <div className="aie-tab-content">
          {tab === 'translate' && <TranslateTab t={t} text={text} onApply={onApply} />}
          {tab === 'fix' && <FixTab t={t} text={text} onApply={onApply} />}
          {tab === 'style' && <StyleTab t={t} text={text} onApply={onApply} />}
          {tab === 'templates' && (
            <TemplateStudio
              platformKey="general"
              platformLabel={t('templates.yourChannels', 'your channels')}
              onUseTemplate={(tplText, media) => onApply(tplText, media)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
