export {
  initializeI18n,
  isSupportedLanguage,
  detectBrowserLanguage,
  getCurrentLanguage,
  changeLanguage,
  SUPPORTED_LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
  DEFAULT_LANGUAGE,
  i18next,
  type SupportedLanguage,
} from './config';

export {
  loadLanguagePreference,
  saveLanguagePreference,
} from './storageAdapters';

export {
  formatNumber,
  formatCompactNumber,
  formatCurrency,
  formatDate,
  formatShortDate,
  formatMonthYear,
  formatRelativeTime,
  formatFileSize,
  formatPercent,
} from './formatters';
