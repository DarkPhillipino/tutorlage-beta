import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Only header/nav copy is translated right now — this is a working
// foundation, not full site coverage. Extending it to other components
// means adding more keys here and swapping their hardcoded strings for
// useTranslation()'s t(). Afrikaans is a standard, stable translation;
// isiZulu/isiXhosa are best-effort (simple, common words) and worth a
// native-speaker check before they're trusted for anything more than nav
// labels — flagged to the user rather than presented as verified.
const resources = {
  en: {
    translation: {
      nav: { learn: 'Learn', teach: 'Teach', schools: 'Schools', resources: 'Resources', about: 'About' },
      about: { aboutTutorlage: 'About Tutorlage', verifiedEducators: 'Verified Educators', careers: 'Careers', pressImpact: 'Press & Impact' },
      help: 'Help',
      manageAccount: 'Manage Account',
    },
  },
  af: {
    translation: {
      nav: { learn: 'Leer', teach: 'Onderrig', schools: 'Skole', resources: 'Hulpbronne', about: 'Oor Ons' },
      about: { aboutTutorlage: 'Oor Tutorlage', verifiedEducators: 'Geverifieerde Opvoeders', careers: 'Loopbane', pressImpact: 'Pers & Impak' },
      help: 'Hulp',
      manageAccount: 'Bestuur Rekening',
    },
  },
  zu: {
    translation: {
      nav: { learn: 'Funda', teach: 'Fundisa', schools: 'Izikole', resources: 'Izinsiza', about: 'Mayelana' },
      about: { aboutTutorlage: 'Mayelana ne-Tutorlage', verifiedEducators: 'Othisha Abaqinisekisiwe', careers: 'Imisebenzi', pressImpact: 'Abezindaba Nomthelela' },
      help: 'Usizo',
      manageAccount: 'Phatha I-akhawunti',
    },
  },
  xh: {
    translation: {
      nav: { learn: 'Funda', teach: 'Fundisa', schools: 'Izikolo', resources: 'Izixhobo', about: 'Malunga' },
      about: { aboutTutorlage: 'Malunga ne-Tutorlage', verifiedEducators: 'Abafundisi Abaqinisekisiweyo', careers: 'Imisebenzi', pressImpact: 'Amaphephandaba Nempembelelo' },
      help: 'Uncedo',
      manageAccount: 'Lawula I-akhawunti',
    },
  },
};

const STORAGE_KEY = 'tutorlage_language';

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: localStorage.getItem(STORAGE_KEY) ?? 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

i18n.on('languageChanged', (lng) => {
  localStorage.setItem(STORAGE_KEY, lng);
});

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'af', label: 'Afrikaans' },
  { code: 'zu', label: 'isiZulu' },
  { code: 'xh', label: 'isiXhosa' },
];

export default i18n;
