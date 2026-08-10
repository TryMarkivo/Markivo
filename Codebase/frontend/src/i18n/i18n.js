import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import translations
import translationUz from './translationUz.json';
import translationRu from './translationRu.json';
import translationEn from './translationEn.json';

// Language resources
const resources = {
  uz: { translation: translationUz },
  ru: { translation: translationRu },
  en: { translation: translationEn }
};

// Initialize i18next
i18n
  .use(initReactI18next) // passes i18n down to react-i18next
  .init({
    resources,
    lng: 'uz', // default language
    fallbackLng: 'en', // fallback language
    interpolation: {
      escapeValue: false // react already safes from xss
    }
  });

export default i18n;