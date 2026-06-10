import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const LanguageSelector = () => {
  const { i18n, t } = useTranslation();

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
    // Save preference to localStorage
    localStorage.setItem('markivo_language', lng);
  };

  // Load language preference from localStorage on mount
  useEffect(() => {
    const savedLang = localStorage.getItem('markivo_language');
    if (savedLang && ['uz', 'ru', 'en'].includes(savedLang)) {
      i18n.changeLanguage(savedLang);
    }
  }, [i18n]);

  const languageOptions = [
    { code: 'uz', name: 'O\'zbek', flag: '🇺🇿' },
    { code: 'ru', name: 'Русский', flag: '🇷🇺' },
    { code: 'en', name: 'English', flag: '🇬🇧' }
  ];

  return (
    <div className="language-selector glass-card">
      <div className="language-header">
        <span className="language-label">{t('common.language') || 'Language'}</span>
        <div className="language-flags">
          {languageOptions.map(lang => (
            <button
              key={lang.code}
              className={`lang-btn ${i18n.language === lang.code ? 'active' : ''}`}
              onClick={() => changeLanguage(lang.code)}
              title={lang.name}
            >
              {lang.flag}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LanguageSelector;