import { useTranslation } from 'react-i18next';
import ScheduleEditor from './ScheduleEditor';

const AUTO = 'auto';
const PLACEHOLDERS = {
  cta: 'e.g. +998 90 123 45 67, Amir Temur 15, @noircafe',
  avoid: 'e.g. prices, competitors, alcohol',
  news: 'e.g. From Monday: pistachio latte, and 10% off before 11:00',
};

/**
 * Autopilot's questions, as quick taps rather than essays. Used both when
 * Autopilot pauses to ask and in the "Your brief" card, where the owner can
 * change any answer at any time.
 *
 * `questions` come from the server (id, type, label, options…); the label
 * shown is this app's translation by id and option value, falling back to
 * the server's English. Every required question has a "You decide" choice.
 */
export default function BriefForm({ questions, values, onChange, disabled, best, idPrefix = 'apq' }) {
  const { t } = useTranslation();
  const label = (q) => t(`autopilot.q.${q.id}.label`, q.label);
  const hint = (q) => (q.hint ? t(`autopilot.q.${q.id}.hint`, q.hint) : '');
  const optLabel = (q, o) => t(`autopilot.q.${q.id}.opt.${o.value}`, o.label);

  const autoChip = (q) => (
    <button
      type="button"
      className={`apq-chip apq-auto ${values[q.id] === AUTO ? 'on' : ''}`}
      aria-pressed={values[q.id] === AUTO}
      disabled={disabled}
      onClick={() => onChange(q.id, values[q.id] === AUTO ? undefined : AUTO)}
    >
      <i className="fa-solid fa-wand-magic-sparkles"></i> {t('autopilot.q.auto', 'Let Autopilot decide')}
    </button>
  );

  return (
    <div className="apq-list">
      {questions.map((q) => {
        const v = values[q.id];
        return (
          <fieldset key={q.id} className="apq" disabled={disabled}>
            <legend className="apq-label">
              {label(q)}
              {q.optional && <span className="apq-optional">{t('autopilot.q.optional', 'optional')}</span>}
            </legend>
            {hint(q) && <p className="apq-hint">{hint(q)}</p>}

            {q.type === 'single' && (
              <div className="apq-chips">
                {q.options.map((o) => (
                  <button
                    type="button"
                    key={o.value}
                    className={`apq-chip ${v === o.value ? 'on' : ''}`}
                    aria-pressed={v === o.value}
                    onClick={() => onChange(q.id, v === o.value ? undefined : o.value)}
                    id={`${idPrefix}_${q.id}_${o.value}`}
                  >
                    {optLabel(q, o)}
                  </button>
                ))}
                {autoChip(q)}
              </div>
            )}

            {q.type === 'multi' && (
              <>
                <div className="apq-chips">
                  {q.options.map((o) => {
                    const on = Array.isArray(v) && v.includes(o.value);
                    return (
                      <button
                        type="button"
                        key={o.value}
                        className={`apq-chip ${on ? 'on' : ''}`}
                        aria-pressed={on}
                        onClick={() => {
                          const list = Array.isArray(v) ? v : [];
                          onChange(q.id, on ? list.filter((x) => x !== o.value) : [...list, o.value]);
                        }}
                        id={`${idPrefix}_${q.id}_${o.value}`}
                      >
                        {on && <i className="fa-solid fa-check"></i>} {optLabel(q, o)}
                      </button>
                    );
                  })}
                  {/* Topics the owner typed in earlier stay visible as chips. */}
                  {Array.isArray(v) && v.filter((x) => !q.options.some((o) => o.value === x)).map((custom) => (
                    <button type="button" key={custom} className="apq-chip on" aria-pressed onClick={() => onChange(q.id, v.filter((x) => x !== custom))}>
                      <i className="fa-solid fa-check"></i> {custom}
                    </button>
                  ))}
                  {autoChip(q)}
                </div>
                {q.allowOther && (
                  <input
                    type="text"
                    className="ui-input apq-other"
                    value={values[`${q.id}Other`] || ''}
                    maxLength={180}
                    placeholder={t('autopilot.q.otherPh', 'Something else? Type it, separated by commas')}
                    onChange={(e) => onChange(`${q.id}Other`, e.target.value)}
                    aria-label={t('autopilot.q.otherLabel', 'Other topics')}
                  />
                )}
              </>
            )}

            {q.type === 'text' && (
              <textarea
                className="ui-textarea apq-text"
                rows={2}
                maxLength={q.max || 300}
                value={v || ''}
                onChange={(e) => onChange(q.id, e.target.value)}
                placeholder={PLACEHOLDERS[q.id] ? t(`autopilot.q.${q.id}.ph`, PLACEHOLDERS[q.id]) : undefined}
                aria-label={label(q)}
              />
            )}

            {q.type === 'schedule' && (
              <>
                <div className="apq-chips">{autoChip(q)}</div>
                {v !== AUTO && (
                  <ScheduleEditor value={v && typeof v === 'object' ? v : null} onChange={(s) => onChange(q.id, s)} disabled={disabled} best={best} idPrefix={`${idPrefix}_s`} />
                )}
              </>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
