import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import './AIGenerationModal.css';

/**
 * Calendar's "AI Generation" popup — text only, no media/scheduling. Writes a
 * draft from a topic, then lets the owner keep asking for changes ("shorter",
 * "add more emojis") before approving it into the Create Post composer.
 *
 * No channel picker: the same draft works for every channel, and which
 * channel(s) to post it to is picked in Create Post afterwards. No language
 * picker either — the draft comes back in whatever language the topic itself
 * was written in.
 */
export default function AIGenerationModal({ activeProfile, onClose, onApprove }) {
  const { t } = useTranslation();

  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState(null); // generated/revised draft, editable
  const [feedback, setFeedback] = useState('');
  const [revising, setRevising] = useState(false);
  const [error, setError] = useState('');

  // Saved writing styles, selectable for this generation — see StyleStudio /
  // gemini.js#analyzeStyle. '' = write in the default brand voice.
  const [styles, setStyles] = useState([]);
  const [styleId, setStyleId] = useState('');

  useEffect(() => {
    api.get('/api/styles').then((rows) => setStyles(Array.isArray(rows) ? rows : [])).catch(() => {});
  }, []);

  const generate = async (e) => {
    e.preventDefault();
    if (!topic.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.post('/api/content/copywrite', {
        topic,
        tone: activeProfile.brandTone || activeProfile.tone,
        businessName: activeProfile.businessName,
        styleId: styleId || undefined,
      });
      setText(data.post);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setLoading(false);
  };

  const revise = async () => {
    if (!feedback.trim() || revising || text == null) return;
    setRevising(true);
    setError('');
    try {
      const data = await api.post('/api/content/copywrite', {
        topic,
        tone: activeProfile.brandTone || activeProfile.tone,
        businessName: activeProfile.businessName,
        styleId: styleId || undefined,
        previousText: text,
        feedback,
      });
      setText(data.post);
      setFeedback('');
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong', 'Something went wrong'));
    }
    setRevising(false);
  };

  const startOver = () => {
    setText(null);
    setFeedback('');
    setError('');
  };

  return (
    <div className="auth-overlay animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="glass-card glass-card-glow text-left aig-card" role="dialog" aria-modal="true" aria-labelledby="aig_title">
        <div className="auth-header flex-between mb-20">
          <h3 id="aig_title"><i className="fa-solid fa-wand-magic-sparkles"></i> {t('aiGeneration.title', 'AI Generation')}</h3>
          <button className="btn-close" onClick={onClose} id="btn_close_ai_generation" aria-label={t('common.close', 'Close')}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {error && <div className="auth-error-box mb-20" role="alert">{error}</div>}

        {text == null ? (
          <form onSubmit={generate}>
            <div className="form-group">
              <label className="form-label" htmlFor="inp_aig_topic">{t('content.copywriter.topicLabel', 'What is the focus of this post?')}</label>
              <textarea
                id="inp_aig_topic"
                className="input-field text-area"
                rows="3"
                placeholder={t('content.copywriter.topicPlaceholder', 'e.g. Free honeycomb cake slices with every double espresso this weekend!')}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                required
              ></textarea>
            </div>

            {styles.length > 0 && (
              <div className="form-group">
                <label className="form-label" htmlFor="sel_aig_style">{t('aiGeneration.styleLabel', 'Style')}</label>
                <select
                  id="sel_aig_style"
                  className="select-field"
                  value={styleId}
                  onChange={(e) => setStyleId(e.target.value)}
                >
                  <option value="">{t('aiGeneration.styleNone', 'Default brand voice')}</option>
                  {styles.map((s) => (
                    <option key={s.id} value={s.id}>{s.name || t('styles.untitled', 'Untitled style')}</option>
                  ))}
                </select>
              </div>
            )}

            <button type="submit" className="btn btn-primary w-full" disabled={loading || !topic.trim()} id="btn_aig_generate">
              {loading ? t('content.copywriter.generating', 'Crafting localized drafts...') : t('aiGeneration.generateCta', 'Generate text ✦')}
            </button>
          </form>
        ) : (
          <div className="animate-fade-in">
            <div className="form-group">
              <label className="form-label" htmlFor="inp_aig_text">{t('aiGeneration.draftLabel', 'Draft')}</label>
              <textarea
                id="inp_aig_text"
                className="input-field text-area aig-draft-textarea"
                rows="8"
                value={text}
                onChange={(e) => setText(e.target.value)}
              ></textarea>
            </div>

            <div className="aig-feedback-row">
              <input
                type="text"
                className="input-field"
                placeholder={t('aiGeneration.feedbackPlaceholder', 'Ask for a change… e.g. "make it shorter" or "add more emojis"')}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); revise(); } }}
                disabled={revising}
                id="inp_aig_feedback"
              />
              <button type="button" className="btn btn-secondary" onClick={revise} disabled={revising || !feedback.trim()} id="btn_aig_revise">
                {revising
                  ? <><i className="fa-solid fa-spinner fa-spin"></i> {t('aiGeneration.revising', 'Revising…')}</>
                  : <><i className="fa-solid fa-arrows-rotate"></i> {t('aiGeneration.revise', 'Revise')}</>}
              </button>
            </div>

            <div className="flex-between mt-20">
              <button type="button" className="btn btn-secondary" onClick={startOver} id="btn_aig_start_over">
                {t('aiGeneration.startOver', 'Start over')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onApprove?.(text)}
                disabled={!text.trim()}
                id="btn_aig_approve"
              >
                <i className="fa-solid fa-circle-check"></i> {t('aiGeneration.approve', 'Approve & continue')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
