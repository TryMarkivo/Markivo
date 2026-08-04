import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import useConnectedPlatforms from '../lib/useConnectedPlatforms';
import { metaFor } from '../lib/platforms';
import PlatformPicker from './PlatformPicker';
import './AIGenerationModal.css';

const LANGUAGES = [
  { code: 'uz', flag: '🇺🇿', label: 'Uzbek' },
  { code: 'ru', flag: '🇷🇺', label: 'Russian' },
  { code: 'en', flag: '🇬🇧', label: 'English' },
];

/**
 * Calendar's "AI Generation" popup — text only, no media/scheduling. Writes a
 * draft from a topic, then lets the owner keep asking for changes ("shorter",
 * "add more emojis") before approving it into the Create Post composer.
 */
export default function AIGenerationModal({ activeProfile, onClose, onApprove }) {
  const { t } = useTranslation();
  const { catalogue, connectStatus, platformKey, setPlatformKey } = useConnectedPlatforms(activeProfile);
  // The name /api/content/copywrite speaks ('instagram', 'facebook', …), not
  // the connector catalogue's key ('meta_instagram', 'meta_facebook', …).
  const generationKey = platformKey ? metaFor(platformKey).generationKey : 'instagram';

  const [topic, setTopic] = useState('');
  const [langs, setLangs] = useState(['en']);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState(null); // generated/revised draft, editable
  const [feedback, setFeedback] = useState('');
  const [revising, setRevising] = useState(false);
  const [error, setError] = useState('');

  const toggleLang = (code) => {
    setLangs((current) => {
      if (!current.includes(code)) return [...current, code];
      if (current.length === 1) return current;
      return current.filter((c) => c !== code);
    });
  };

  const generate = async (e) => {
    e.preventDefault();
    if (!topic.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.post('/api/content/copywrite', {
        platform: generationKey,
        topic,
        languages: langs,
        tone: activeProfile.brandTone || activeProfile.tone,
        businessName: activeProfile.businessName,
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
        platform: generationKey,
        topic,
        languages: langs,
        tone: activeProfile.brandTone || activeProfile.tone,
        businessName: activeProfile.businessName,
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

        {catalogue && (
          <div className="form-group">
            <label className="form-label">{t('aiGeneration.channel', 'Channel')}</label>
            <PlatformPicker catalogue={catalogue} connectStatus={connectStatus} platformKey={platformKey} onSelect={setPlatformKey} />
          </div>
        )}

        {text == null ? (
          <form onSubmit={generate}>
            <div className="form-group">
              <label className="form-label">{t('content.copywriter.languageLabel', 'Post Language')}</label>
              <div className="lang-chip-row">
                {LANGUAGES.map((lang) => {
                  const position = langs.indexOf(lang.code);
                  const selected = position !== -1;
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      className={`lang-chip ${selected ? 'active' : ''}`}
                      onClick={() => toggleLang(lang.code)}
                      aria-pressed={selected}
                      id={`btn_aig_lang_${lang.code}`}
                    >
                      {selected && <span className="lang-chip-order">{position + 1}</span>}
                      <span className="lang-chip-flag">{lang.flag}</span>
                      <span>{t(`content.copywriter.lang.${lang.code}`, lang.label)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

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
                onClick={() => onApprove?.(text, platformKey)}
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
