import { useEffect, useRef } from 'react';
import { useUIStore } from '@/stores/useUIStore';
import {
  initializeI18n,
  detectBrowserLanguage,
  isSupportedLanguage,
  changeLanguage,
  DEFAULT_LANGUAGE,
} from '@/lib/i18n/config';
import {
  loadLanguagePreference,
  saveLanguagePreference,
} from '@/lib/i18n/storageAdapters';

/**
 * Hook to initialize i18next and manage language state.
 * Should be called once at the app root level.
 */
export function useI18nInitializer() {
  const { language, setLanguage } = useUIStore();
  const initializedRef = useRef(false);
  const prevLanguageRef = useRef(language);

  // Initialize i18n on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    (async () => {
      // 1. Try runtime-specific storage (Desktop/VSCode)
      let resolvedLang = await loadLanguagePreference();

      // 2. Fall back to Zustand persisted value (Web localStorage)
      if (!resolvedLang && isSupportedLanguage(language)) {
        resolvedLang = language;
      }

      // 3. Fall back to browser language detection
      if (!resolvedLang) {
        resolvedLang = detectBrowserLanguage();
      }

      // 4. Final fallback
      if (!resolvedLang) {
        resolvedLang = DEFAULT_LANGUAGE;
      }

      // Initialize i18next
      await initializeI18n(resolvedLang);

      // Sync store if different
      if (resolvedLang !== language) {
        setLanguage(resolvedLang);
      }

      // Set HTML lang attribute for accessibility
      document.documentElement.lang = resolvedLang;
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle language changes after init
  useEffect(() => {
    if (!initializedRef.current) return;
    if (language === prevLanguageRef.current) return;

    prevLanguageRef.current = language;

    (async () => {
      await changeLanguage(language);
      document.documentElement.lang = language;
      await saveLanguagePreference(language);
    })();
  }, [language]);
}
