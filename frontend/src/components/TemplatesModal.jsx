import { useTranslation } from 'react-i18next';
import TemplateStudio from './TemplateStudio';
import './CreatePost.css';

// Templates aren't split per channel — one shared library, usable on
// whichever platform(s) the post ends up going out to.
const SHARED_PLATFORM_KEY = 'general';

/**
 * Calendar's "Edit Templates" popup — TemplateStudio itself is untouched;
 * this just gives it a home outside the Create Post composer. Using a saved
 * template hands its text/media to the caller, which opens it in Create Post
 * exactly like an approved AI Generation draft does.
 */
export default function TemplatesModal({ onClose, onUseTemplate }) {
  const { t } = useTranslation();

  return (
    <div className="auth-overlay animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="cp-templates-modal" role="dialog" aria-modal="true" aria-label={t('templates.title', 'Message Templates')}>
        <button className="btn-close cp-templates-close" onClick={onClose} id="btn_close_templates_modal" aria-label={t('common.close', 'Close')}>
          <i className="fa-solid fa-xmark"></i>
        </button>

        <TemplateStudio
          platformKey={SHARED_PLATFORM_KEY}
          platformLabel={t('templates.yourChannels', 'your channels')}
          onUseTemplate={(text, media) => onUseTemplate?.(text, media)}
        />
      </div>
    </div>
  );
}
