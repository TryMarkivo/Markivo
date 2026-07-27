import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import './TemplateStudio.css';

// Mirrors the backend placeholder format (backend/gemini.js) so the preview and
// the variable chips update as you type, with no round trip.
const placeholderRe = () => /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

const extractKeys = (text) => {
  const seen = [];
  for (const m of String(text || '').matchAll(placeholderRe())) {
    const key = m[1].toLowerCase();
    if (!seen.includes(key)) seen.push(key);
  }
  return seen;
};

const renderTemplate = (text, values = {}) =>
  String(text || '').replace(placeholderRe(), (_, k) => {
    const v = values[k.toLowerCase()];
    return v == null || v === '' ? '____' : String(v);
  });

const humanize = (key) => String(key || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const toKey = (raw, fallback) =>
  String(raw || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || fallback;

/**
 * Per-platform message templates. The owner pastes a message they already send
 * ("Stadium No:141, 9 spots left ✅"); Gemini returns it with the changing parts
 * turned into {{variables}}. Extraction is a SUGGESTION, not a verdict — the
 * template text stays fully editable and variables can be added from a
 * selection or removed with one click, so a bad guess is never a dead end.
 */
export default function TemplateStudio({ platformKey, platformLabel, onUseTemplate }) {
  const { t } = useTranslation();

  const [engine, setEngine] = useState(null);
  const [saved, setSaved] = useState([]);
  const [loadingList, setLoadingList] = useState(true);

  // Draft being built (from an analysis, or edited by hand).
  const [sample, setSample] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [draft, setDraft] = useState(null); // { name, templateText, varMeta, source }
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Fill-and-use state for a saved template: { id, values }
  const [filling, setFilling] = useState(null);

  const templateRef = useRef(null);

  // Bumped after a save/delete to re-run the list fetch below.
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/templates?platform=${encodeURIComponent(platformKey)}`)
      .then((rows) => { if (!cancelled) setSaved(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setSaved([]); })
      .finally(() => { if (!cancelled) setLoadingList(false); });
    return () => { cancelled = true; };
  }, [platformKey, reloadToken]);

  useEffect(() => { api.get('/api/templates/engine').then(setEngine).catch(() => setEngine(null)); }, []);

  const draftKeys = draft ? extractKeys(draft.templateText) : [];
  const metaFor = (key) => (draft && draft.varMeta[key]) || { label: humanize(key), example: '' };

  const patchDraft = (patch) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const handleAnalyze = async () => {
    if (!sample.trim() || analyzing) return;
    setAnalyzing(true);
    setError('');
    try {
      const data = await api.post('/api/templates/analyze', { sample, platform: platformKey });
      const varMeta = {};
      (data.variables || []).forEach((v) => { varMeta[v.key] = { label: v.label, example: v.example }; });
      setDraft({ name: data.name || '', templateText: data.templateText || '', varMeta, source: data.source || 'manual' });
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setAnalyzing(false);
  };

  // Start a template by hand — the same editor, seeded with the raw message and
  // no variables, for when there is nothing numeric for the parser to find.
  const handleStartBlank = () => {
    setError('');
    setDraft({ name: '', templateText: sample, varMeta: {}, source: 'manual' });
  };

  // Turn the currently selected text in the editor into a variable. This is the
  // escape hatch for anything the analysis missed (a name, a district, a dish).
  const handleMakeVariable = () => {
    const el = templateRef.current;
    if (!el || !draft) return;
    const { selectionStart: start, selectionEnd: end } = el;
    if (start === end) {
      setError(t('templates.selectFirst', 'Select the part of the message that changes, then press “Make variable”.'));
      return;
    }
    const selected = draft.templateText.slice(start, end);
    if (selected.includes('{{')) {
      setError(t('templates.alreadyVariable', 'That selection already contains a variable.'));
      return;
    }
    // Name it after the words just before the selection, the way the offline
    // parser does ("Stadium No:" -> stadium_no); fall back to value_N.
    const before = draft.templateText.slice(0, start).match(/[\p{L}]+/gu) || [];
    const existing = extractKeys(draft.templateText);
    let key = toKey(before.slice(-2).join('_'), `value_${existing.length + 1}`);
    if (existing.includes(key)) {
      let n = 2;
      while (existing.includes(`${key}_${n}`)) n += 1;
      key = `${key}_${n}`;
    }
    setError('');
    patchDraft({
      templateText: `${draft.templateText.slice(0, start)}{{${key}}}${draft.templateText.slice(end)}`,
      varMeta: { ...draft.varMeta, [key]: { label: humanize(key), example: selected } },
    });
  };

  // Removing a variable puts its example value back into the text, so the
  // message reads correctly again instead of leaving a hole.
  const handleRemoveVariable = (key) => {
    const meta = metaFor(key);
    const replaced = draft.templateText.replace(
      new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'),
      meta.example || humanize(key)
    );
    patchDraft({ templateText: replaced });
  };

  // Renaming rewrites the placeholder in the text — the text stays the source
  // of truth, exactly as the backend treats it.
  const handleRenameVariable = (key, rawName) => {
    const next = toKey(rawName, key);
    if (next === key || extractKeys(draft.templateText).includes(next)) return;
    const varMeta = { ...draft.varMeta };
    varMeta[next] = varMeta[key] || { label: humanize(next), example: '' };
    delete varMeta[key];
    patchDraft({
      templateText: draft.templateText.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), `{{${next}}}`),
      varMeta,
    });
  };

  const handleExampleChange = (key, example) =>
    patchDraft({ varMeta: { ...draft.varMeta, [key]: { ...metaFor(key), example } } });

  const handleSave = async () => {
    if (!draft || !draft.templateText.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.post('/api/templates', {
        platform: platformKey,
        name: draft.name || draft.templateText.slice(0, 40),
        sampleText: sample,
        templateText: draft.templateText,
        variables: draftKeys.map((key) => ({ key, ...metaFor(key) })),
        source: draft.source,
      });
      setDraft(null);
      setSample('');
      refresh();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    try {
      await api.del(`/api/templates/${id}`);
      if (filling && filling.id === id) setFilling(null);
      refresh();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
  };

  const openFill = (tpl) => {
    const values = {};
    (tpl.variables || []).forEach((v) => { values[v.key] = v.example || ''; });
    setFilling({ id: tpl.id, values });
  };

  const engineBadge = engine && engine.gemini
    ? t('templates.engineGemini', 'Gemini')
    : t('templates.engineOffline', 'Offline parser');

  return (
    <div className="template-studio glass-card">
      <div className="panel-title-wrap">
        <i className="fa-solid fa-shapes text-accent icon-header"></i>
        <div>
          <h3>{t('templates.title', 'Message Templates')}</h3>
          <p className="text-muted">
            {t('templates.subtitle', {
              defaultValue: 'Paste a message you already send on {{platform}} — we turn the changing parts into variables you can refill in seconds.',
              platform: platformLabel,
            })}
          </p>
        </div>
      </div>

      {error && <div className="auth-error-box mt-10" role="alert">{error}</div>}

      {/* --- STEP 1: paste a real message --- */}
      <div className="form-group mt-20">
        <label className="form-label" htmlFor={`inp_template_sample_${platformKey}`}>
          {t('templates.sampleLabel', 'A message you send often')}
        </label>
        <textarea
          id={`inp_template_sample_${platformKey}`}
          className="input-field text-area"
          rows="3"
          placeholder={t('templates.samplePlaceholder', 'e.g. Stadium No:141, 9 spots left✅')}
          value={sample}
          onChange={(e) => setSample(e.target.value)}
        ></textarea>
      </div>

      <div className="template-actions">
        <button
          className="btn btn-primary"
          onClick={handleAnalyze}
          disabled={analyzing || !sample.trim()}
          id={`btn_analyze_template_${platformKey}`}
        >
          {analyzing
            ? t('templates.analyzing', 'Finding the variable parts…')
            : t('templates.analyzeCta', 'Analyze & build template ✦')}
        </button>
        <button className="btn btn-secondary" onClick={handleStartBlank} disabled={!sample.trim()}>
          {t('templates.startManual', 'Mark variables myself')}
        </button>
        {engine && <span className="template-engine-badge">{engineBadge}</span>}
      </div>

      {/* --- STEP 2: review, edit, save --- */}
      {draft && (
        <div className="template-draft animate-fade-in">
          <div className="form-group">
            <label className="form-label" htmlFor={`inp_template_name_${platformKey}`}>
              {t('templates.nameLabel', 'Template name')}
            </label>
            <input
              id={`inp_template_name_${platformKey}`}
              className="input-field"
              value={draft.name}
              onChange={(e) => patchDraft({ name: e.target.value })}
              placeholder={t('templates.namePlaceholder', 'e.g. Spots left update')}
            />
          </div>

          <div className="form-group">
            <div className="flex-between">
              <label className="form-label" htmlFor={`inp_template_text_${platformKey}`}>
                {t('templates.templateLabel', 'Template')}
              </label>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleMakeVariable}
                id={`btn_make_variable_${platformKey}`}
              >
                <i className="fa-solid fa-wand-magic-sparkles"></i> {t('templates.makeVariable', 'Make variable')}
              </button>
            </div>
            <textarea
              ref={templateRef}
              id={`inp_template_text_${platformKey}`}
              className="input-field text-area template-text-input"
              rows="4"
              value={draft.templateText}
              onChange={(e) => patchDraft({ templateText: e.target.value })}
            ></textarea>
            <p className="template-hint text-muted">
              {t('templates.editHint', 'Select any text above and press “Make variable”, or delete a variable below to put its value back.')}
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">
              {t('templates.variablesLabel', { defaultValue: 'Variables ({{count}})', count: draftKeys.length })}
            </label>
            {draftKeys.length === 0 ? (
              <p className="text-muted template-hint">
                {t('templates.noVariables', 'No variables yet — select the part of the message that changes and press “Make variable”.')}
              </p>
            ) : (
              <div className="variable-list">
                {draftKeys.map((key) => (
                  <div key={key} className="variable-row">
                    <input
                      className="input-field variable-key-input"
                      defaultValue={key}
                      onBlur={(e) => handleRenameVariable(key, e.target.value)}
                      aria-label={t('templates.variableName', 'Variable name')}
                    />
                    <input
                      className="input-field variable-example-input"
                      value={metaFor(key).example}
                      onChange={(e) => handleExampleChange(key, e.target.value)}
                      placeholder={t('templates.examplePlaceholder', 'Example value')}
                      aria-label={t('templates.examplePlaceholder', 'Example value')}
                    />
                    <button
                      type="button"
                      className="btn-close variable-remove"
                      onClick={() => handleRemoveVariable(key)}
                      aria-label={t('templates.removeVariable', { defaultValue: 'Remove variable {{key}}', key })}
                      title={t('templates.removeVariable', { defaultValue: 'Remove variable {{key}}', key })}
                    >
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="template-preview">
            <span className="template-preview-label">{t('templates.preview', 'Preview')}</span>
            <pre className="copy-text-area">{renderTemplate(draft.templateText)}</pre>
          </div>

          <div className="template-actions">
            <button className="btn btn-secondary" onClick={() => setDraft(null)}>
              {t('common.discard', 'Discard')}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || !draft.templateText.trim()}
              id={`btn_save_template_${platformKey}`}
            >
              {saving ? t('templates.saving', 'Saving…') : t('templates.saveCta', 'Save template')}
            </button>
          </div>
        </div>
      )}

      {/* --- SAVED TEMPLATES for this platform --- */}
      <div className="saved-templates">
        <h4>{t('templates.savedTitle', { defaultValue: 'Saved for {{platform}}', platform: platformLabel })}</h4>
        {loadingList ? (
          <div className="text-center" style={{ padding: 20 }}>
            <i className="fa-solid fa-spinner fa-spin text-accent"></i>
          </div>
        ) : saved.length === 0 ? (
          <p className="text-muted template-hint">
            {t('templates.savedEmpty', 'No templates yet for this platform.')}
          </p>
        ) : (
          saved.map((tpl) => {
            const open = filling && filling.id === tpl.id;
            return (
              <div key={tpl.id} className="saved-template-card">
                <div className="flex-between">
                  <div>
                    <strong>{tpl.name || t('templates.untitled', 'Untitled template')}</strong>
                    <p className="template-hint text-muted">{renderTemplate(tpl.templateText)}</p>
                  </div>
                  <div className="flex-gap-8">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => (open ? setFilling(null) : openFill(tpl))}
                      id={`btn_fill_template_${tpl.id}`}
                    >
                      {open ? t('common.close', 'Close') : t('templates.useCta', 'Use')}
                    </button>
                    <button
                      className="btn-close"
                      onClick={() => handleDelete(tpl.id)}
                      aria-label={t('templates.deleteTemplate', 'Delete template')}
                      title={t('templates.deleteTemplate', 'Delete template')}
                    >
                      <i className="fa-solid fa-trash"></i>
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="template-fill animate-fade-in">
                    {(tpl.variables || []).length === 0 ? (
                      <p className="template-hint text-muted">
                        {t('templates.fixedTemplate', 'This template has no variables — it sends exactly as written.')}
                      </p>
                    ) : (
                      tpl.variables.map((v) => (
                        <div className="form-group" key={v.key}>
                          <label className="form-label" htmlFor={`inp_fill_${tpl.id}_${v.key}`}>{v.label || v.key}</label>
                          <input
                            id={`inp_fill_${tpl.id}_${v.key}`}
                            className="input-field"
                            value={filling.values[v.key] || ''}
                            placeholder={v.example}
                            onChange={(e) => setFilling((f) => ({ ...f, values: { ...f.values, [v.key]: e.target.value } }))}
                          />
                        </div>
                      ))
                    )}
                    <pre className="copy-text-area">{renderTemplate(tpl.templateText, filling.values)}</pre>
                    <div className="template-actions">
                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          onUseTemplate?.(renderTemplate(tpl.templateText, filling.values));
                          setFilling(null);
                        }}
                        id={`btn_use_template_${tpl.id}`}
                      >
                        <i className="fa-solid fa-arrow-right-to-bracket"></i>{' '}
                        {t('templates.sendToComposer', 'Send to composer')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
