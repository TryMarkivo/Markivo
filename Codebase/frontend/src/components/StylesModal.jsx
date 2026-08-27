import { useTranslation } from 'react-i18next';
import StyleStudio from './StyleStudio';
import './CreatePost.css';

/**
 * Calendar's "Edit Styles" popup — mirrors TemplatesModal, just gives
 * StyleStudio a home outside the Create Post composer. Styles aren't inserted
 * directly into a post the way templates are; they're picked as a generation
 * parameter in the AI Generation modal, so there is no onUseStyle hand-off
 * here — this is purely the manage (create/edit/delete) surface.
 */
export default function StylesModal({ onClose }) {
  const { t } = useTranslation();

  return (
    <div className="auth-overlay animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="cp-templates-modal" role="dialog" aria-modal="true" aria-label={t('styles.title', 'Writing Styles')}>
        <button className="btn-close cp-templates-close" onClick={onClose} id="btn_close_styles_modal" aria-label={t('common.close', 'Close')}>
          <i className="fa-solid fa-xmark"></i>
        </button>

        <StyleStudio />
      </div>
    </div>
  );
}
