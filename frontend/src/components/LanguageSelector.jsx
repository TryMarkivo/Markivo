import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/* Compact pill switcher: 🇺🇿 UZ · 🇷🇺 RU · 🇬🇧 EN */
const LanguageSelector = ({ onChange }) => {
  const { i18n } = useTranslation();

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
    localStorage.setItem('markivo_language', lng);
    onChange?.(lng); // optional: persist to the user's profile when signed in
  };

  // Load language preference from localStorage on mount
  useEffect(() => {
    const savedLang = localStorage.getItem('markivo_language');
    if (savedLang && ['uz', 'ru', 'en'].includes(savedLang)) {
      i18n.changeLanguage(savedLang);
    }
  }, [i18n]);

  const languageOptions = [
    { code: 'uz', label: 'UZ', name: "O'zbek", flag: '🇺🇿' },
    { code: 'ru', label: 'RU', name: 'Русский', flag: '🇷🇺' },
    { code: 'en', label: 'EN', name: 'English', flag: '🇬🇧' },
  ];

  return (
    <div className="language-selector" role="group" aria-label="Language">
      {languageOptions.map((lang) => (
        <button
          key={lang.code}
          className={`lang-btn ${i18n.language === lang.code ? 'active' : ''}`}
          onClick={() => changeLanguage(lang.code)}
          title={lang.name}
          id={`btn_lang_${lang.code}`}
        >
          <span>{lang.flag}</span>
          {lang.label}
        </button>
      ))}
    </div>
  );
};

export default LanguageSelector;
