import { useTranslation } from 'react-i18next';
import LanguageSelector from './LanguageSelector';
import ThemeToggle from './ThemeToggle';
import ConnectionsPanel from './ConnectionsPanel';
import './SettingsPane.css';

/**
 * Dashboard Settings tab: appearance (theme + language), platform
 * connections, and account basics.
 */
export default function SettingsPane({ activeProfile, theme, onToggleTheme, onLanguageChange }) {
  const { t } = useTranslation();

  return (
    <div className="settings-pane animate-fade-in">
      <h2 className="settings-title">{t('settings.title', 'Settings')}</h2>

      {/* APPEARANCE */}
      <section className="settings-section glass-card">
        <h3><i className="fa-solid fa-palette text-accent"></i> {t('settings.appearance', 'Appearance')}</h3>
        <div className="settings-row">
          <span>{t('settings.theme', 'Theme')}</span>
          <div className="settings-row-control">
            <span className="settings-muted">{theme === 'dark' ? t('settings.dark', 'Dark') : t('settings.light', 'Light')}</span>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
        </div>
        <div className="settings-row">
          <span>{t('settings.language', 'Language')}</span>
          <LanguageSelector onChange={onLanguageChange} />
        </div>
      </section>

      {/* PLATFORM CONNECTIONS */}
      <ConnectionsPanel activeProfile={activeProfile} />
    </div>
  );
}
