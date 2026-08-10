import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import MediaAttach from './MediaAttach';
import './TemplateStudio.css';

// Mirrors the backend placeholder format (backend/gemini.js) so the inline view
// and the chips update as you type, with no round trip.
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

// The saved-template list is a picker, not a reading view — a long template
// (a whole football schedule, say) only needs enough of a preview to
// recognise it by. CSS line-clamps the common case (many short lines); this
// catches the other one (one very long line) so the card never balloons.
const PREVIEW_MAX_CHARS = 220;
const previewOf = (text) => {
  const s = String(text || '');
  return s.length > PREVIEW_MAX_CHARS ? `${s.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…` : s;
};

const toKey = (raw, fallback) =>
  String(raw || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || fallback;

/**
 * Split the template into the pieces the inline view renders: literal runs and
 * variables, each literal tagged with its absolute offset so a text selection
 * inside it can be mapped straight back to an index in the template string.
 */
const toSegments = (text) => {
  const src = String(text || '');
  const out = [];
  let last = 0;
  for (const m of src.matchAll(placeholderRe())) {
    if (m.index > last) out.push({ type: 'text', value: src.slice(last, m.index), start: last });
    out.push({ type: 'var', key: m[1].toLowerCase(), start: m.index });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ type: 'text', value: src.slice(last), start: last });
  return out;
};

/**
 * The message itself, with every variable highlighted in place. This is the
 * whole editor surface: you read the post exactly as it will go out, and the
 * variables are things you can see and click rather than a separate list of
 * form fields sitting somewhere below the text.
 *
 * mode 'edit' — chips show the value with an × to drop the variable.
 * mode 'fill' — chips ARE the inputs, so the post updates as you type in them.
 */
function InlineTemplate({ mode, text, values, meta, onSelect, onRemove, onEditVar, onValueChange, activeKey }) {
  const { t } = useTranslation();
  const ref = useRef(null);

  // Map a DOM selection back to character offsets in the template string. Only
  // a selection living inside ONE literal run counts — anything wider has a
  // variable in the middle of it and can't become a single new variable.
  const readSelection = () => {
    if (!onSelect) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return onSelect(null);
    const range = sel.getRangeAt(0);
    if (!ref.current || !ref.current.contains(range.commonAncestorContainer)) return onSelect(null);

    const runOf = (node) => {
      let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      while (el && el.dataset?.start === undefined) el = el.parentElement;
      return el;
    };
    const startRun = runOf(range.startContainer);
    const endRun = runOf(range.endContainer);
    if (!startRun || startRun !== endRun) return onSelect(null);

    // Offsets are character positions when the boundary sits in the text node,
    // but child indexes when the whole run is selected — normalise to chars.
    const charOffset = (container, offset) =>
      container.nodeType === Node.TEXT_NODE ? offset : (offset === 0 ? 0 : startRun.textContent.length);

    const base = Number(startRun.dataset.start);
    const start = base + charOffset(range.startContainer, range.startOffset);
    const end = base + charOffset(range.endContainer, range.endOffset);
    return onSelect(end > start ? { start, end } : null);
  };

  return (
    <div
      ref={ref}
      className={`tpl-canvas tpl-canvas-${mode}`}
      onMouseUp={readSelection}
      onKeyUp={readSelection}
    >
      {toSegments(text).map((seg, i) => {
        if (seg.type === 'text') {
          return (
            <span key={i} className="tpl-literal" data-start={seg.start}>{seg.value}</span>
          );
        }
        const info = meta(seg.key);
        const value = values[seg.key];

        if (mode === 'fill') {
          return (
            <input
              key={i}
              className="tpl-chip-input"
              value={value || ''}
              placeholder={info.example || humanize(seg.key)}
              title={info.label || humanize(seg.key)}
              aria-label={info.label || humanize(seg.key)}
              style={{ width: `${Math.max(6, (value || info.example || seg.key).length + 2)}ch` }}
              onChange={(e) => onValueChange(seg.key, e.target.value)}
            />
          );
        }

        return (
          <span key={i} className={`tpl-chip ${activeKey === seg.key ? 'active' : ''}`}>
            <button
              type="button"
              className="tpl-chip-body"
              onClick={() => onEditVar(seg.key)}
              title={t('templates.editVariable', 'Rename this variable or change its example')}
            >
              <span className="tpl-chip-name">{info.label || humanize(seg.key)}</span>
              <span className="tpl-chip-value">{info.example || '____'}</span>
            </button>
            <button
              type="button"
              className="tpl-chip-remove"
              onClick={() => onRemove(seg.key)}
              aria-label={t('templates.removeVariable', { defaultValue: 'Remove variable {{key}}', key: seg.key })}
              title={t('templates.removeVariable', { defaultValue: 'Remove variable {{key}}', key: seg.key })}
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Per-platform message templates. The owner pastes a message they already send
 * ("Stadium No:141, 9 spots left ✅"); Gemini returns it with the changing parts
 * turned into {{variables}}. Extraction is a SUGGESTION, not a verdict — every
 * variable can be dropped with one ×, any missed one can be created by
 * selecting it in the text, and a saved template can be reopened and edited.
 */
export default function TemplateStudio({ platformKey, platformLabel, onUseTemplate }) {
  const { t } = useTranslation();

  const [engine, setEngine] = useState(null);
  const [saved, setSaved] = useState([]);
  const [loadingList, setLoadingList] = useState(true);

  // Draft being built. `id` is set when editing a template that already exists.
  const [sample, setSample] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [draft, setDraft] = useState(null); // { id, name, templateText, varMeta, source }
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Current text selection inside the inline view, and the chip being renamed.
  const [selection, setSelection] = useState(null);
  const [activeVar, setActiveVar] = useState(null);
  const [rawMode, setRawMode] = useState(false);

  // Fill-and-use state for a saved template: { id, values }
  const [filling, setFilling] = useState(null);

  const editorRef = useRef(null);

  // "Use" opens the fill-in-place editor for that one card; bring it into
  // view instead of leaving the owner to scroll down and hunt for it,
  // especially past a long saved template above it.
  useEffect(() => {
    if (!filling) return;
    document.getElementById(`tpl_card_${filling.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    // Deliberately keyed on the id alone — `filling.values` changes on every
    // keystroke while filling a variable, and re-scrolling on each one would
    // fight the owner's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filling?.id]);

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
  const exampleValues = () => {
    const values = {};
    draftKeys.forEach((key) => { values[key] = metaFor(key).example; });
    return values;
  };

  const patchDraft = (patch) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const openDraft = (next) => {
    setDraft(next);
    setSelection(null);
    setActiveVar(null);
    setRawMode(false);
  };

  const handleAnalyze = async () => {
    if (!sample.trim() || analyzing) return;
    setAnalyzing(true);
    setError('');
    try {
      const data = await api.post('/api/templates/analyze', { sample, platform: platformKey });
      const varMeta = {};
      (data.variables || []).forEach((v) => { varMeta[v.key] = { label: v.label, example: v.example }; });
      openDraft({
        id: null,
        name: data.name || '',
        templateText: data.templateText || '',
        varMeta,
        source: data.source || 'manual',
        media: null,
      });
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setAnalyzing(false);
  };

  // Start a template by hand — the same editor, seeded with the raw message and
  // no variables, for when there is nothing for the parser to find.
  const handleStartBlank = () => {
    setError('');
    openDraft({ id: null, name: '', templateText: sample, varMeta: {}, source: 'manual', media: null });
  };

  // Reopen a saved template in the editor. Same surface as a fresh draft, so
  // there is nothing new to learn — it just saves over the original.
  const handleEditSaved = (tpl) => {
    const varMeta = {};
    (tpl.variables || []).forEach((v) => { varMeta[v.key] = { label: v.label, example: v.example }; });
    setError('');
    setFilling(null);
    setSample(tpl.sampleText || '');
    openDraft({
      id: tpl.id,
      name: tpl.name || '',
      templateText: tpl.templateText || '',
      varMeta,
      source: tpl.source || 'manual',
      media: tpl.mediaId ? { id: tpl.mediaId, url: tpl.mediaUrl, kind: tpl.mediaKind || 'image' } : null,
    });
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Turn the current selection into a variable. This is the escape hatch for
  // anything the analysis missed — a name, a district, a dish.
  const handleMakeVariable = () => {
    if (!draft || !selection) return;
    const { start, end } = selection;
    const selected = draft.templateText.slice(start, end);
    if (!selected.trim()) return;

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
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    patchDraft({
      templateText: `${draft.templateText.slice(0, start)}{{${key}}}${draft.templateText.slice(end)}`,
      varMeta: { ...draft.varMeta, [key]: { label: humanize(key), example: selected.trim() } },
    });
    setActiveVar(key);
  };

  // Removing a variable puts its example value back into the text, so the
  // message still reads correctly instead of being left with a hole.
  const handleRemoveVariable = (key) => {
    const meta = metaFor(key);
    const varMeta = { ...draft.varMeta };
    delete varMeta[key];
    if (activeVar === key) setActiveVar(null);
    patchDraft({
      templateText: draft.templateText.replace(
        new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'),
        meta.example || humanize(key)
      ),
      varMeta,
    });
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
    setActiveVar(next);
  };

  const handleExampleChange = (key, example) =>
    patchDraft({ varMeta: { ...draft.varMeta, [key]: { ...metaFor(key), example } } });

  const handleSave = async () => {
    if (!draft || !draft.templateText.trim() || saving) return;
    setSaving(true);
    setError('');
    const body = {
      platform: platformKey,
      name: draft.name || draft.templateText.slice(0, 40),
      sampleText: sample,
      templateText: draft.templateText,
      variables: draftKeys.map((key) => ({ key, ...metaFor(key) })),
      source: draft.source,
      // Explicit null detaches on edit — omitting the field would keep the old one.
      mediaId: draft.media?.id || null,
    };
    try {
      if (draft.id) await api.put(`/api/templates/${draft.id}`, body);
      else await api.post('/api/templates', body);
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
      if (draft && draft.id === id) setDraft(null);
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

      {/* --- STEP 2: the message, with its variables highlighted in place --- */}
      {draft && (
        <div className="template-draft animate-fade-in" ref={editorRef}>
          <div className="template-draft-head">
            <span className="template-draft-mode">
              {draft.id
                ? t('templates.editingBadge', 'Editing saved template')
                : t('templates.newBadge', 'New template')}
            </span>
            <input
              className="input-field template-name-input"
              value={draft.name}
              onChange={(e) => patchDraft({ name: e.target.value })}
              placeholder={t('templates.namePlaceholder', 'e.g. Spots left update')}
              aria-label={t('templates.nameLabel', 'Template name')}
            />
          </div>

          <div className="tpl-toolbar">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleMakeVariable}
              disabled={!selection}
              id={`btn_make_variable_${platformKey}`}
            >
              <i className="fa-solid fa-wand-magic-sparkles"></i>{' '}
              {selection
                ? t('templates.makeVariableFrom', {
                  defaultValue: 'Make “{{text}}” a variable',
                  text: draft.templateText.slice(selection.start, selection.end).trim().slice(0, 24),
                })
                : t('templates.makeVariable', 'Make variable')}
            </button>
            <button
              type="button"
              className={`btn btn-secondary btn-sm ${rawMode ? 'active' : ''}`}
              onClick={() => { setRawMode((v) => !v); setSelection(null); }}
            >
              <i className="fa-solid fa-pen"></i>{' '}
              {rawMode ? t('templates.doneEditingText', 'Done editing text') : t('templates.editText', 'Edit wording')}
            </button>
          </div>

          {rawMode ? (
            <textarea
              className="input-field text-area template-text-input"
              rows="4"
              value={draft.templateText}
              onChange={(e) => patchDraft({ templateText: e.target.value })}
              aria-label={t('templates.templateLabel', 'Template')}
            ></textarea>
          ) : (
            <InlineTemplate
              mode="edit"
              text={draft.templateText}
              values={exampleValues()}
              meta={metaFor}
              activeKey={activeVar}
              onSelect={setSelection}
              onRemove={handleRemoveVariable}
              onEditVar={(key) => setActiveVar((k) => (k === key ? null : key))}
            />
          )}

          <p className="template-hint text-muted">
            {draftKeys.length === 0
              ? t('templates.noVariables', 'No variables yet — select the part of the message that changes and press “Make variable”.')
              : t('templates.inlineHint', 'Highlight any text to turn it into a variable, click a variable to rename it, or press × to turn it back into plain text.')}
          </p>

          {/* Rename / example editor for the chip you clicked. */}
          {activeVar && draftKeys.includes(activeVar) && (
            <div className="tpl-var-editor animate-fade-in">
              <div className="form-group">
                <label className="form-label" htmlFor={`inp_var_name_${activeVar}`}>
                  {t('templates.variableName', 'Variable name')}
                </label>
                <input
                  id={`inp_var_name_${activeVar}`}
                  className="input-field"
                  defaultValue={activeVar}
                  onBlur={(e) => handleRenameVariable(activeVar, e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor={`inp_var_example_${activeVar}`}>
                  {t('templates.examplePlaceholder', 'Example value')}
                </label>
                <input
                  id={`inp_var_example_${activeVar}`}
                  className="input-field"
                  value={metaFor(activeVar).example}
                  onChange={(e) => handleExampleChange(activeVar, e.target.value)}
                />
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActiveVar(null)}>
                {t('common.done', 'Done')}
              </button>
            </div>
          )}

          {/* Media saved WITH the template: an Instagram template is useless
              without it, since Instagram has no text-only post type. */}
          <div className="form-group tpl-media">
            <label className="form-label">{t('templates.mediaLabel', 'Photo or video for this template')}</label>
            <MediaAttach
              value={draft.media}
              onChange={(media) => patchDraft({ media })}
              disabled={saving}
              hint={t('templates.mediaHint', 'Optional. Every post made from this template goes out with this media attached.')}
            />
          </div>

          <div className="template-actions">
            <button className="btn btn-secondary" onClick={() => setDraft(null)}>
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || !draft.templateText.trim()}
              id={`btn_save_template_${platformKey}`}
            >
              {saving
                ? t('templates.saving', 'Saving…')
                : draft.id
                  ? t('templates.saveChanges', 'Save changes')
                  : t('templates.saveCta', 'Save template')}
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
            const meta = (key) => (tpl.variables || []).find((v) => v.key === key) || { label: humanize(key), example: '' };
            return (
              <div key={tpl.id} id={`tpl_card_${tpl.id}`} className={`saved-template-card ${open ? 'is-active' : ''}`}>
                <div className="tpl-card-head">
                  <div className="tpl-card-text">
                    <strong>{tpl.name || t('templates.untitled', 'Untitled template')}</strong>
                    {tpl.mediaId && (
                      <span className="tpl-media-badge" title={t('templates.hasMedia', 'Has attached media')}>
                        <i className={`fa-solid ${tpl.mediaKind === 'video' ? 'fa-video' : 'fa-image'}`}></i>
                      </span>
                    )}
                    <p className="template-hint text-muted tpl-card-preview">
                      {previewOf(renderTemplate(tpl.templateText, Object.fromEntries((tpl.variables || []).map((v) => [v.key, v.example]))))}
                    </p>
                  </div>
                  <div className="tpl-card-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => (open ? setFilling(null) : openFill(tpl))}
                      id={`btn_fill_template_${tpl.id}`}
                    >
                      <i className={`fa-solid ${open ? 'fa-xmark' : 'fa-arrow-right-to-bracket'}`}></i>{' '}
                      {open ? t('common.close', 'Close') : t('templates.useCta', 'Use')}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleEditSaved(tpl)}
                      id={`btn_edit_template_${tpl.id}`}
                    >
                      <i className="fa-solid fa-pen-to-square"></i> {t('common.edit', 'Edit')}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm tpl-delete-btn"
                      onClick={() => handleDelete(tpl.id)}
                      aria-label={t('templates.deleteTemplate', 'Delete template')}
                      title={t('templates.deleteTemplate', 'Delete template')}
                      id={`btn_delete_template_${tpl.id}`}
                    >
                      <i className="fa-solid fa-trash"></i> {t('common.delete', 'Delete')}
                    </button>
                  </div>
                </div>

                {/* Filling happens IN the message: type in the highlighted spots
                    and you are reading the finished post as you go. */}
                {open && (
                  <div className="template-fill animate-fade-in">
                    {(tpl.variables || []).length === 0 ? (
                      <p className="template-hint text-muted">
                        {t('templates.fixedTemplate', 'This template has no variables — it sends exactly as written.')}
                      </p>
                    ) : (
                      <InlineTemplate
                        mode="fill"
                        text={tpl.templateText}
                        values={filling.values}
                        meta={meta}
                        onValueChange={(key, value) =>
                          setFilling((f) => ({ ...f, values: { ...f.values, [key]: value } }))}
                      />
                    )}
                    <div className="template-actions">
                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          onUseTemplate?.(
                            renderTemplate(tpl.templateText, filling.values),
                            tpl.mediaId ? { id: tpl.mediaId, url: tpl.mediaUrl, kind: tpl.mediaKind || 'image' } : null
                          );
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
