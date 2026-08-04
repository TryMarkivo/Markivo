import { useTranslation } from 'react-i18next';
import useConnectedPlatforms from '../lib/useConnectedPlatforms';
import PlatformPicker from './PlatformPicker';
import TemplateStudio from './TemplateStudio';
import './CreatePost.css';

/**
 * Calendar's "Edit Templates" popup — TemplateStudio itself is untouched;
 * this just gives it a channel picker and a home outside the Create Post
 * composer. Using a saved template hands its text/media to the caller, which
 * opens it in Create Post exactly like an approved AI Generation draft does.
 */
export default function TemplatesModal({ activeProfile, initialPlatformKey, onClose, onUseTemplate }) {
  const { t } = useTranslation();
  const { catalogue, connectStatus, platformKey, setPlatformKey, platform } = useConnectedPlatforms(activeProfile, initialPlatformKey);

  return (
    <div className="auth-overlay animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="cp-templates-modal" role="dialog" aria-modal="true" aria-label={t('templates.title', 'Message Templates')}>
        <button className="btn-close cp-templates-close" onClick={onClose} id="btn_close_templates_modal" aria-label={t('common.close', 'Close')}>
          <i className="fa-solid fa-xmark"></i>
        </button>

        {catalogue && (
          <div className="form-group" style={{ marginBottom: 18 }}>
            <label className="form-label">{t('aiGeneration.channel', 'Channel')}</label>
            <PlatformPicker catalogue={catalogue} connectStatus={connectStatus} platformKey={platformKey} onSelect={setPlatformKey} />
          </div>
        )}

        {platformKey && (
          <TemplateStudio
            key={platformKey}
            platformKey={platformKey}
            platformLabel={platform?.label || platformKey}
            onUseTemplate={(text, media) => onUseTemplate?.(text, media, platformKey)}
          />
        )}
      </div>
    </div>
  );
}
