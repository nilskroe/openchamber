import { isDesktopRuntime, getDesktopSettings, updateDesktopSettings } from '@/lib/desktop';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';

/**
 * Load language preference from runtime-specific storage.
 * Priority: runtime storage > localStorage fallback
 */
export async function loadLanguagePreference(): Promise<string | null> {
  // Desktop (Tauri)
  if (isDesktopRuntime()) {
    try {
      const settings = await getDesktopSettings();
      return settings?.language || null;
    } catch {
      return null;
    }
  }

  // VSCode
  const runtimeAPIs = getRegisteredRuntimeAPIs();
  if (runtimeAPIs?.runtime?.isVSCode && runtimeAPIs?.settings) {
    try {
      const result = await runtimeAPIs.settings.load();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (result?.settings as any)?.language || null;
    } catch {
      return null;
    }
  }

  // Web - Zustand persistence handles this via localStorage
  // Return null to let Zustand hydration take over
  return null;
}

/**
 * Save language preference to runtime-specific storage.
 * Called after setLanguage() updates Zustand store.
 */
export async function saveLanguagePreference(lang: string): Promise<void> {
  // Desktop (Tauri)
  if (isDesktopRuntime()) {
    try {
      await updateDesktopSettings({ language: lang });
    } catch (e) {
      console.warn('Failed to save language to desktop settings:', e);
    }
    return;
  }

  // VSCode
  const runtimeAPIs = getRegisteredRuntimeAPIs();
  if (runtimeAPIs?.runtime?.isVSCode && runtimeAPIs?.settings) {
    try {
      await runtimeAPIs.settings.save({ language: lang });
    } catch (e) {
      console.warn('Failed to save language to VSCode settings:', e);
    }
    return;
  }

  // Web - Zustand persistence handles this automatically
}
