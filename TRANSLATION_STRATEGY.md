# Translation (i18n) Implementation Strategy for OpenChamber

## Executive Summary

Introduce multi-language support across all OpenChamber runtimes (Web, Desktop, VS Code) with user language selection in settings. This strategy prioritizes **minimal disruption**, **runtime flexibility**, and **maintainability**.

---

## 1. Technology Stack Selection

### Recommended: `i18next`

**Why i18next:**
- Battle-tested in large React apps
- Framework-agnostic (works across Web, Desktop, VSCode)
- Pluralization & interpolation out-of-the-box
- React binding via `react-i18next` with hooks
- Namespace splitting for code organization
- Trans component for JSX interpolation (links, bold text, etc.)

### Dependencies to add:
```json
{
  "i18next": "^23.x",
  "react-i18next": "^14.x"
}
```

**Note:** No `i18next-http-backend` or `i18next-browser-languagedetector` needed. We use static imports for all translations (bundled at build time) and handle language detection/persistence ourselves via Zustand store.

---

## 2. Architecture Overview

### 2.1 Translation File Structure

```
packages/ui/src/locales/
├── en-US/
│   ├── common.json          // Shared UI strings (buttons, labels, etc.)
│   ├── chat.json            // Chat-specific strings
│   ├── settings.json        // Settings panel strings
│   ├── git.json             // Git operations
│   ├── terminal.json        // Terminal strings
│   └── errors.json          // Error messages
├── es-ES/
│   └── ... (same structure)
├── fr-FR/
│   └── ...
├── de-DE/
│   └── ...
├── zh-CN/
│   └── ...
├── uk-UA/
│   └── ...
└── it-IT/
    └── ...
```

### 2.2 Storage & Persistence

**Language preference stored in:**
1. **Zustand store** (`useUIStore`) - frontend state with persistence
2. **Runtime-specific persistence:**
   - **Web:** localStorage (via Zustand's `createJSONStorage`)
   - **Desktop (Tauri):** DesktopSettings via `updateDesktopSettings({ language })`
   - **VSCode:** Settings API via `runtimeSettings.save({ language })`

```typescript
// In useUIStore.ts - add to interface
interface UIStore {
  language: string;  // e.g., 'en-US', 'es-ES'
  setLanguage: (lang: string) => void;
}
```

### 2.3 Initialization Flow

```
App.tsx
  ↓
useI18nInitializer() hook
  ├─ Load saved preference from runtime storage
  ├─ Fallback: detect browser language
  ├─ Fallback: 'en-US'
  ├─ Initialize i18next with resolved language
  └─ Set document.documentElement.lang
```

### 2.4 Language Detection Priority

1. Saved user preference (runtime-specific storage)
2. Browser/system language (if supported)
3. Default: `en-US`

---

## 3. Implementation Phases

### Phase 1: Core Infrastructure (Foundation) - COMPLETED
**Deliverables:**
- [x] Add i18next + react-i18next packages to `packages/ui`
- [x] Create locale folder structure with English translations
- [x] Create i18next config file (`packages/ui/src/lib/i18n/config.ts`)
- [x] Create `useI18nInitializer` hook
- [x] Extend `useUIStore` with `language` field
- [x] Add `language` to Zustand persistence partialize

### Phase 2: Settings UI & Runtime Storage - COMPLETED
**Deliverables:**
- [x] Create `LanguageSettings.tsx` component
- [x] Add "Language" section to OpenChamber settings sidebar
- [x] Update `OpenChamberPage.tsx` to render language settings
- [x] Extend `DesktopSettings` type with `language` field
- [x] Extend VSCode `SettingsPayload` type with `language` field
- [x] Create storage adapter for cross-runtime persistence

### Phase 3: String Migration - IN PROGRESS
**Completed:**
- [x] Migrate high-impact areas first: chat input, error messages, settings labels
- [x] Create translation keys following naming convention
- [x] Add pluralization for counts (messages, files, etc.)
- [x] Add JSX interpolation where needed (Trans component)
- [x] SessionSidebar, HelpDialog, CommandPalette
- [x] Settings pages (Agents, Commands, GitIdentities, Providers)
- [x] ChatEmptyState, SessionDialogs, DirectoryExplorerDialog
- [x] PermissionRequest, PermissionCard, ChatInput, FileAttachment
- [x] All Git components (GitView, BranchSelector, ChangeRow, etc.)
- [x] ModelControls (model/agent selectors, tooltips, dropdowns)
- [x] Settings Sidebars (Agents, Commands, Providers, GitIdentities)
- [x] OpenChamber Settings (About, Defaults, SessionRetention)
- [x] TerminalView (error messages, status, action buttons)
- [x] OnboardingScreen (welcome screen)
- [x] DiffView (all status messages, file counts, controls)
- [x] DirectoryTree (all labels, tooltips, loading states)
- [x] ServerFilePicker (all labels, search, selection states)

**Remaining components to migrate:**
- [ ] Message parts (AssistantTextPart, UserTextPart, ToolPart, etc.)
- [ ] Any remaining toast messages scattered in the codebase
- [ ] Minor UI components with hardcoded strings

### Phase 4: Locale-Aware Formatting - COMPLETED
**Deliverables:**
- [x] Create centralized formatting utilities (`packages/ui/src/lib/i18n/formatters.ts`)
- [x] Replace hardcoded `'en-US'` in existing `Intl.NumberFormat` and `Intl.DateTimeFormat` calls
- [x] Add formatters: `formatNumber`, `formatCurrency`, `formatDate`, `formatRelativeTime`

### Phase 5: Additional Languages - COMPLETED
**Deliverables:**
- [x] Generate translations for ES, FR, DE, ZH, UK, IT using AI
- [x] Review and polish translations
- [ ] Test RTL readiness (future: Arabic, Hebrew)

---

## 4. Detailed Implementation Guide

### 4.1 i18next Configuration

**File: `packages/ui/src/lib/i18n/config.ts`**

```typescript
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

// Static imports - all translations bundled at build time
import enCommon from '@/locales/en-US/common.json';
import enChat from '@/locales/en-US/chat.json';
import enSettings from '@/locales/en-US/settings.json';
import enGit from '@/locales/en-US/git.json';
import enTerminal from '@/locales/en-US/terminal.json';
import enErrors from '@/locales/en-US/errors.json';

// Import other languages similarly...
import esCommon from '@/locales/es-ES/common.json';
import esChat from '@/locales/es-ES/chat.json';
// ... etc

const resources = {
  'en-US': {
    common: enCommon,
    chat: enChat,
    settings: enSettings,
    git: enGit,
    terminal: enTerminal,
    errors: enErrors,
  },
  'es-ES': {
    common: esCommon,
    chat: esChat,
    // ... etc
  },
  // ... other languages
};

export const SUPPORTED_LANGUAGES = [
  { code: 'en-US', label: 'English', nativeName: 'English' },
  { code: 'es-ES', label: 'Spanish', nativeName: 'Espanol' },
  { code: 'fr-FR', label: 'French', nativeName: 'Francais' },
  { code: 'de-DE', label: 'German', nativeName: 'Deutsch' },
  { code: 'zh-CN', label: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'uk-UA', label: 'Ukrainian', nativeName: 'Українська' },
  { code: 'it-IT', label: 'Italian', nativeName: 'Italiano' },
] as const;

export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map(l => l.code);

export const initializeI18n = async (language: string) => {
  if (i18next.isInitialized) {
    await i18next.changeLanguage(language);
    return;
  }

  await i18next
    .use(initReactI18next)
    .init({
      resources,
      lng: language,
      fallbackLng: 'en-US',
      ns: ['common', 'chat', 'settings', 'git', 'terminal', 'errors'],
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
};

// Helper to check if a language code is supported
export const isSupportedLanguage = (code: string): boolean => {
  return SUPPORTED_LANGUAGE_CODES.includes(code as typeof SUPPORTED_LANGUAGE_CODES[number]);
};

// Get browser language if supported, otherwise null
export const detectBrowserLanguage = (): string | null => {
  if (typeof navigator === 'undefined') return null;
  
  const browserLang = navigator.language;
  if (isSupportedLanguage(browserLang)) return browserLang;
  
  // Try base language (e.g., 'es' from 'es-MX')
  const baseLang = browserLang.split('-')[0];
  const match = SUPPORTED_LANGUAGES.find(l => l.code.startsWith(baseLang + '-'));
  return match?.code || null;
};
```

### 4.2 Zustand Store Extension

**File: `packages/ui/src/stores/useUIStore.ts` (modifications)**

```typescript
// Add to interface
interface UIStore {
  // ... existing fields ...
  language: string;
  setLanguage: (lang: string) => void;
}

// Add to create() implementation
{
  // ... existing state ...
  language: 'en-US',
  
  setLanguage: (lang: string) => {
    set({ language: lang });
    // i18next.changeLanguage is called by the hook/component
    // Runtime persistence is handled by storage adapter
  },
}

// Add to partialize (for persistence)
partialize: (state) => ({
  // ... existing fields ...
  language: state.language,
}),
```

### 4.3 Storage Adapter for Runtimes

**File: `packages/ui/src/lib/i18n/storageAdapters.ts`**

```typescript
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
  if (runtimeAPIs?.settings) {
    try {
      const result = await runtimeAPIs.settings.load();
      return result?.settings?.language || null;
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
  if (runtimeAPIs?.settings) {
    try {
      await runtimeAPIs.settings.save({ language: lang });
    } catch (e) {
      console.warn('Failed to save language to VSCode settings:', e);
    }
    return;
  }

  // Web - Zustand persistence handles this automatically
}
```

### 4.4 Desktop Settings Type Update

**File: `packages/ui/src/lib/desktop.ts` (add to DesktopSettings type)**

```typescript
export type DesktopSettings = {
  // ... existing fields ...
  language?: string;  // e.g., 'en-US', 'es-ES'
};
```

### 4.5 Initialization Hook

**File: `packages/ui/src/hooks/useI18nInitializer.ts`**

```typescript
import { useEffect, useRef } from 'react';
import i18next from 'i18next';
import { useUIStore } from '@/stores/useUIStore';
import { initializeI18n, detectBrowserLanguage, isSupportedLanguage } from '@/lib/i18n/config';
import { loadLanguagePreference, saveLanguagePreference } from '@/lib/i18n/storageAdapters';

export function useI18nInitializer() {
  const { language, setLanguage } = useUIStore();
  const initializedRef = useRef(false);

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
        resolvedLang = 'en-US';
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
  }, []);

  // Handle language changes after init
  useEffect(() => {
    if (!i18next.isInitialized) return;
    
    const currentLang = i18next.language;
    if (language !== currentLang) {
      i18next.changeLanguage(language);
      document.documentElement.lang = language;
      saveLanguagePreference(language);
    }
  }, [language]);
}
```

### 4.6 Integration in App.tsx

**File: `packages/ui/src/App.tsx` (add near top of component)**

```typescript
import { useI18nInitializer } from '@/hooks/useI18nInitializer';

function App({ apis }: AppProps) {
  useI18nInitializer();  // Initialize i18n early
  
  // ... rest of component ...
}
```

### 4.7 Language Settings Component

**File: `packages/ui/src/components/sections/openchamber/LanguageSettings.tsx`**

```typescript
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '@/stores/useUIStore';
import { SUPPORTED_LANGUAGES } from '@/lib/i18n/config';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const LanguageSettings: React.FC = () => {
  const { t } = useTranslation('settings');
  const { language, setLanguage } = useUIStore();

  return (
    <SettingsSection
      title={t('language.title', 'Language')}
      description={t('language.description', 'Choose your preferred display language')}
    >
      <Select value={language} onValueChange={setLanguage}>
        <SelectTrigger className="w-full max-w-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_LANGUAGES.map((lang) => (
            <SelectItem key={lang.code} value={lang.code}>
              {lang.nativeName} ({lang.label})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsSection>
  );
};
```

### 4.8 OpenChamber Settings Updates

**File: `packages/ui/src/components/sections/openchamber/OpenChamberSidebar.tsx`**

```typescript
// Update type
export type OpenChamberSection = 'visual' | 'chat' | 'sessions' | 'language';

// Update OPENCHAMBER_SECTION_GROUPS
const OPENCHAMBER_SECTION_GROUPS: SectionGroup[] = [
  { id: 'visual', label: 'Visual', items: ['Theme', 'Font', 'Spacing'] },
  { id: 'chat', label: 'Chat', items: ['Tools', 'Diff', 'Reasoning'] },
  { id: 'sessions', label: 'Sessions', items: ['Defaults', 'Retention'] },
  { id: 'language', label: 'Language', items: ['Display Language'] },
];
```

**File: `packages/ui/src/components/sections/openchamber/OpenChamberPage.tsx`**

```typescript
import { LanguageSettings } from './LanguageSettings';

// Add to section rendering logic
if (section === 'language') {
  return <LanguageSettings />;
}
```

---

## 5. Locale-Aware Formatting

### 5.1 Centralized Formatters

**File: `packages/ui/src/lib/i18n/formatters.ts`**

```typescript
import i18next from 'i18next';

// Get current language, fallback to en-US
const getLocale = () => i18next.language || 'en-US';

// Number formatting
export const formatNumber = (
  value: number,
  options?: Intl.NumberFormatOptions
): string => {
  return new Intl.NumberFormat(getLocale(), options).format(value);
};

export const formatCompactNumber = (value: number): string => {
  return new Intl.NumberFormat(getLocale(), {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(value);
};

export const formatCurrency = (
  value: number,
  currency: string = 'USD'
): string => {
  return new Intl.NumberFormat(getLocale(), {
    style: 'currency',
    currency,
    maximumFractionDigits: 4,
    minimumFractionDigits: 2,
  }).format(value);
};

// Date formatting
export const formatDate = (
  date: Date | number | string,
  options?: Intl.DateTimeFormatOptions
): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(getLocale(), options).format(d);
};

export const formatShortDate = (date: Date | number | string): string => {
  return formatDate(date, { month: 'short', day: 'numeric', year: 'numeric' });
};

export const formatMonthYear = (date: Date | number | string): string => {
  return formatDate(date, { month: 'short', year: 'numeric' });
};

export const formatRelativeTime = (date: Date | number): string => {
  const now = Date.now();
  const timestamp = typeof date === 'number' ? date : date.getTime();
  const diffMs = now - timestamp;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });

  if (diffDays > 0) return rtf.format(-diffDays, 'day');
  if (diffHours > 0) return rtf.format(-diffHours, 'hour');
  if (diffMins > 0) return rtf.format(-diffMins, 'minute');
  return rtf.format(-diffSecs, 'second');
};

// File size formatting
export const formatFileSize = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${formatNumber(size, { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
};
```

### 5.2 Migration of Existing Formatters

Replace hardcoded `'en-US'` in:
- `packages/ui/src/components/chat/ModelControls.tsx`
- `packages/ui/src/components/sections/providers/ProvidersPage.tsx`

```typescript
// Before
const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat('en-US', { ... });

// After
import { formatCompactNumber, formatCurrency } from '@/lib/i18n/formatters';
// Use formatCompactNumber(value) and formatCurrency(value) directly
```

---

## 6. Translation Key Conventions

### 6.1 Naming Convention

```
{namespace}.{section}.{element}.{variant}
```

Examples:
- `common.button.save` - Save button
- `common.button.cancel` - Cancel button
- `chat.input.placeholder` - Chat input placeholder
- `chat.message.empty` - Empty state message
- `settings.language.title` - Language setting title
- `errors.connection.failed` - Connection error

### 6.2 Pluralization

Use i18next plural syntax:

```json
// en-US/chat.json
{
  "message": {
    "count_one": "{{count}} message",
    "count_other": "{{count}} messages"
  },
  "file": {
    "count_one": "{{count}} file",
    "count_other": "{{count}} files"
  }
}
```

Usage:
```typescript
t('chat:message.count', { count: 5 }) // "5 messages"
t('chat:message.count', { count: 1 }) // "1 message"
```

### 6.3 JSX Interpolation (Trans Component)

For strings with embedded components (links, bold text):

```typescript
import { Trans } from 'react-i18next';

// Translation: "Click <link>here</link> to learn more"
<Trans i18nKey="common.help.learnMore" components={{ link: <a href="/docs" /> }} />

// Translation: "You have <bold>{{count}}</bold> unread messages"
<Trans 
  i18nKey="chat.unread" 
  values={{ count: 5 }}
  components={{ bold: <strong /> }} 
/>
```

Translation file:
```json
{
  "help": {
    "learnMore": "Click <link>here</link> to learn more"
  },
  "unread": "You have <bold>{{count}}</bold> unread messages"
}
```

---

## 7. Translation File Organization

### Example: Common Strings

**`packages/ui/src/locales/en-US/common.json`**
```json
{
  "button": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "create": "Create",
    "confirm": "Confirm",
    "close": "Close",
    "retry": "Retry"
  },
  "label": {
    "model": "Model",
    "agent": "Agent",
    "provider": "Provider",
    "loading": "Loading...",
    "noResults": "No results"
  },
  "time": {
    "today": "Today",
    "yesterday": "Yesterday",
    "daysAgo": "{{count}} days ago"
  }
}
```

**`packages/ui/src/locales/en-US/errors.json`**
```json
{
  "connection": {
    "failed": "Failed to connect to server",
    "timeout": "Connection timed out",
    "retry": "Retrying connection..."
  },
  "validation": {
    "required": "This field is required",
    "invalid": "Invalid input"
  },
  "generic": {
    "unknown": "An unexpected error occurred",
    "tryAgain": "Please try again"
  }
}
```

---

## 8. Error Handling

### 8.1 Missing Translation Fallback

i18next is configured to fall back to English (`fallbackLng: 'en-US'`) when a translation is missing. This ensures users always see readable text.

### 8.2 Missing Key Detection (Development)

```typescript
// In config.ts, add to init options (dev only)
if (process.env.NODE_ENV === 'development') {
  i18next.on('missingKey', (lngs, ns, key, fallbackValue) => {
    console.warn(`[i18n] Missing key: ${ns}:${key} for languages: ${lngs.join(', ')}`);
  });
}
```

### 8.3 Initialization Failure Recovery

If i18next fails to initialize, components using `useTranslation()` will return the fallback values provided in `t()` calls:

```typescript
// Always provide fallback for critical UI
t('button.save', 'Save')
```

---

## 9. Migration Path (Minimal Disruption)

### Step 1: Infrastructure (no user-visible changes)
- Add i18next packages
- Create locale folder with English strings only
- Add language to stores (default: en-US)
- Settings UI hidden behind feature flag or just exists but does nothing visible yet

### Step 2: Settings UI
- Enable language selector in OpenChamber settings
- Only English available initially
- Verify persistence works across all runtimes

### Step 3: Gradual string migration
- Start with highest-impact: chat input, buttons, error messages
- Replace strings file-by-file
- Keep hardcoded fallbacks: `t('key', 'Fallback text')`

### Step 4: Add languages
- Generate translations via AI
- Add one language at a time
- Test each language in all runtimes

### Step 5: Format migration
- Replace hardcoded Intl formatters
- Test date/number formatting per locale

---

## 10. Performance Considerations

### Bundle Size
- **i18next + react-i18next:** ~30KB (gzipped: ~10KB)
- **Translation files:** ~5-15KB per language (all namespaces)
- **Impact:** Negligible. All translations bundled statically.

### Runtime Performance
- No network requests for translations (static imports)
- Language switching is instant (all resources loaded)
- React re-renders only components using changed translations

### Tree Shaking
- Unused languages are NOT tree-shaken (static imports)
- If bundle size becomes concern, consider dynamic imports per language

---

## 11. Future Enhancements

### 11.1 RTL Support (Arabic, Hebrew)
```typescript
// In useI18nInitializer, after language change:
const rtlLanguages = ['ar', 'he', 'fa'];
const isRTL = rtlLanguages.some(rtl => language.startsWith(rtl));
document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
```

### 11.2 Dynamic Language Loading
If bundle size becomes a concern with many languages:
```typescript
// Convert to dynamic imports
const loadLanguage = async (lang: string) => {
  const resources = await import(`@/locales/${lang}/index.ts`);
  i18next.addResourceBundle(lang, 'common', resources.common);
  // ... etc
};
```

### 11.3 AI Translation Pipeline
- Use AI to generate initial translations
- Store in `packages/ui/src/locales/{lang}/`
- Human review before merge
- No external translation platform dependency

---

## 12. Success Metrics

- All user-facing strings use `t()` calls
- 7 languages available (EN, ES, FR, DE, ZH, UK, IT)
- Language persists across app restarts in all runtimes
- Settings UI accessible in Web, Desktop, and VSCode
- Real-time language switching without page reload
- Dates and numbers formatted per locale
- No hardcoded `'en-US'` in Intl formatters

---

## 13. Files to Create/Modify

### New Files
- `packages/ui/src/lib/i18n/config.ts`
- `packages/ui/src/lib/i18n/storageAdapters.ts`
- `packages/ui/src/lib/i18n/formatters.ts`
- `packages/ui/src/hooks/useI18nInitializer.ts`
- `packages/ui/src/components/sections/openchamber/LanguageSettings.tsx`
- `packages/ui/src/locales/en-US/*.json` (6 namespace files)
- `packages/ui/src/locales/{other-langs}/*.json` (per language)

### Modified Files
- `packages/ui/package.json` - add i18next dependencies
- `packages/ui/src/stores/useUIStore.ts` - add language state
- `packages/ui/src/App.tsx` - add useI18nInitializer
- `packages/ui/src/lib/desktop.ts` - add language to DesktopSettings type
- `packages/ui/src/components/sections/openchamber/OpenChamberSidebar.tsx` - add language section
- `packages/ui/src/components/sections/openchamber/OpenChamberPage.tsx` - render LanguageSettings
- `packages/ui/src/components/chat/ModelControls.tsx` - use formatters
- `packages/ui/src/components/sections/providers/ProvidersPage.tsx` - use formatters

---

## Conclusion

This strategy enables professional-grade multi-language support with minimal disruption. Static bundling eliminates network latency, Zustand integration provides seamless persistence, and the phased approach allows incremental adoption without breaking existing functionality.
