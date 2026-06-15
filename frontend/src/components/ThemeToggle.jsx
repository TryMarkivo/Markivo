import { useTranslation } from 'react-i18next';

/* Small round light/dark switch. Theme state lives in App.jsx. */
export default function ThemeToggle({ theme, onToggle }) {
  const { t } = useTranslation();
  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      id="btn_theme_toggle"
      title={theme === 'dark' ? t('common.themeToLight', 'Switch to light theme') : t('common.themeToDark', 'Switch to dark theme')}
      aria-label={t('common.themeToggle', 'Toggle color theme')}
    >
      <i className={`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
    </button>
  );
}
