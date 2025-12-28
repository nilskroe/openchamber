import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

// Static imports - all translations bundled at build time
// English
import enCommon from '@/locales/en-US/common.json';
import enChat from '@/locales/en-US/chat.json';
import enSettings from '@/locales/en-US/settings.json';
import enGit from '@/locales/en-US/git.json';
import enTerminal from '@/locales/en-US/terminal.json';
import enErrors from '@/locales/en-US/errors.json';
import enUi from '@/locales/en-US/ui.json';

// Spanish
import esCommon from '@/locales/es-ES/common.json';
import esChat from '@/locales/es-ES/chat.json';
import esSettings from '@/locales/es-ES/settings.json';
import esGit from '@/locales/es-ES/git.json';
import esTerminal from '@/locales/es-ES/terminal.json';
import esErrors from '@/locales/es-ES/errors.json';
import esUi from '@/locales/es-ES/ui.json';

// French
import frCommon from '@/locales/fr-FR/common.json';
import frChat from '@/locales/fr-FR/chat.json';
import frSettings from '@/locales/fr-FR/settings.json';
import frGit from '@/locales/fr-FR/git.json';
import frTerminal from '@/locales/fr-FR/terminal.json';
import frErrors from '@/locales/fr-FR/errors.json';
import frUi from '@/locales/fr-FR/ui.json';

// German
import deCommon from '@/locales/de-DE/common.json';
import deChat from '@/locales/de-DE/chat.json';
import deSettings from '@/locales/de-DE/settings.json';
import deGit from '@/locales/de-DE/git.json';
import deTerminal from '@/locales/de-DE/terminal.json';
import deErrors from '@/locales/de-DE/errors.json';
import deUi from '@/locales/de-DE/ui.json';

// Chinese (Simplified)
import zhCommon from '@/locales/zh-CN/common.json';
import zhChat from '@/locales/zh-CN/chat.json';
import zhSettings from '@/locales/zh-CN/settings.json';
import zhGit from '@/locales/zh-CN/git.json';
import zhTerminal from '@/locales/zh-CN/terminal.json';
import zhErrors from '@/locales/zh-CN/errors.json';
import zhUi from '@/locales/zh-CN/ui.json';

// Ukrainian
import ukCommon from '@/locales/uk-UA/common.json';
import ukChat from '@/locales/uk-UA/chat.json';
import ukSettings from '@/locales/uk-UA/settings.json';
import ukGit from '@/locales/uk-UA/git.json';
import ukTerminal from '@/locales/uk-UA/terminal.json';
import ukErrors from '@/locales/uk-UA/errors.json';
import ukUi from '@/locales/uk-UA/ui.json';

// Italian
import itCommon from '@/locales/it-IT/common.json';
import itChat from '@/locales/it-IT/chat.json';
import itSettings from '@/locales/it-IT/settings.json';
import itGit from '@/locales/it-IT/git.json';
import itTerminal from '@/locales/it-IT/terminal.json';
import itErrors from '@/locales/it-IT/errors.json';
import itUi from '@/locales/it-IT/ui.json';

const resources = {
  'en-US': {
    common: enCommon,
    chat: enChat,
    settings: enSettings,
    git: enGit,
    terminal: enTerminal,
    errors: enErrors,
    ui: enUi,
  },
  'es-ES': {
    common: esCommon,
    chat: esChat,
    settings: esSettings,
    git: esGit,
    terminal: esTerminal,
    errors: esErrors,
    ui: esUi,
  },
  'fr-FR': {
    common: frCommon,
    chat: frChat,
    settings: frSettings,
    git: frGit,
    terminal: frTerminal,
    errors: frErrors,
    ui: frUi,
  },
  'de-DE': {
    common: deCommon,
    chat: deChat,
    settings: deSettings,
    git: deGit,
    terminal: deTerminal,
    errors: deErrors,
    ui: deUi,
  },
  'zh-CN': {
    common: zhCommon,
    chat: zhChat,
    settings: zhSettings,
    git: zhGit,
    terminal: zhTerminal,
    errors: zhErrors,
    ui: zhUi,
  },
  'uk-UA': {
    common: ukCommon,
    chat: ukChat,
    settings: ukSettings,
    git: ukGit,
    terminal: ukTerminal,
    errors: ukErrors,
    ui: ukUi,
  },
  'it-IT': {
    common: itCommon,
    chat: itChat,
    settings: itSettings,
    git: itGit,
    terminal: itTerminal,
    errors: itErrors,
    ui: itUi,
  },
};

export type SupportedLanguage = {
  code: string;
  label: string;
  nativeName: string;
};

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en-US', label: 'English', nativeName: 'English' },
  { code: 'es-ES', label: 'Spanish', nativeName: 'Espanol' },
  { code: 'fr-FR', label: 'French', nativeName: 'Francais' },
  { code: 'de-DE', label: 'German', nativeName: 'Deutsch' },
  { code: 'zh-CN', label: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'uk-UA', label: 'Ukrainian', nativeName: 'Українська' },
  { code: 'it-IT', label: 'Italian', nativeName: 'Italiano' },
];

export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map(l => l.code);

export const DEFAULT_LANGUAGE = 'en-US';

/**
 * Initialize i18next with the given language.
 * If already initialized, changes the language instead.
 */
export const initializeI18n = async (language: string): Promise<void> => {
  if (i18next.isInitialized) {
    await i18next.changeLanguage(language);
    return;
  }

  await i18next
    .use(initReactI18next)
    .init({
      resources,
      lng: language,
      fallbackLng: DEFAULT_LANGUAGE,
      ns: ['common', 'chat', 'settings', 'git', 'terminal', 'errors', 'ui'],
      defaultNS: 'common',
      interpolation: {
        escapeValue: false, // React already escapes
      },
      react: {
        useSuspense: false, // Don't block render
      },
      // Show English text for missing keys instead of the key itself
      returnNull: false,
      returnEmptyString: false,
    });

  // Development: log missing keys
  if (process.env.NODE_ENV === 'development') {
    i18next.on('missingKey', (lngs, ns, key) => {
      console.warn(`[i18n] Missing key: ${ns}:${key} for languages: ${lngs.join(', ')}`);
    });
  }
};

/**
 * Check if a language code is supported.
 */
export const isSupportedLanguage = (code: string): boolean => {
  return SUPPORTED_LANGUAGE_CODES.includes(code);
};

/**
 * Get browser language if supported, otherwise null.
 */
export const detectBrowserLanguage = (): string | null => {
  if (typeof navigator === 'undefined') return null;

  const browserLang = navigator.language;
  if (isSupportedLanguage(browserLang)) return browserLang;

  // Try base language (e.g., 'es' from 'es-MX')
  const baseLang = browserLang.split('-')[0];
  const match = SUPPORTED_LANGUAGES.find(l => l.code.startsWith(baseLang + '-'));
  return match?.code || null;
};

/**
 * Get the current i18next language.
 */
export const getCurrentLanguage = (): string => {
  return i18next.language || DEFAULT_LANGUAGE;
};

/**
 * Change the current language.
 */
export const changeLanguage = async (language: string): Promise<void> => {
  if (!i18next.isInitialized) {
    await initializeI18n(language);
    return;
  }
  await i18next.changeLanguage(language);
};

export { i18next };
