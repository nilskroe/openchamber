import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts'
import './index.css'
import App from './App.tsx'
import { SessionAuthGate } from './components/auth/SessionAuthGate'
import { ThemeSystemProvider } from './contexts/ThemeSystemContext'
import { ThemeProvider } from './components/providers/ThemeProvider'
import './lib/debug'
import { syncDesktopSettings, initializeAppearancePreferences } from './lib/persistence'
import { startAppearanceAutoSave } from './lib/appearanceAutoSave'
import { startAppRunnerAutoSave } from './lib/appRunnerAutoSave'
import { applyPersistedDirectoryPreferences } from './lib/directoryPersistence'
import { startTypographyWatcher } from './lib/typographyWatcher'
import { useChatStore } from './stores/useChatStore'
import type { RuntimeAPIs } from './lib/api/types'

declare global {
  interface Window {
    __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs;
  }
}

const runtimeAPIs = (typeof window !== 'undefined' && window.__OPENCHAMBER_RUNTIME_APIS__) || (() => {
  throw new Error('Runtime APIs not provided for legacy UI entrypoint.');
})();

await syncDesktopSettings();
await initializeAppearancePreferences();
startAppearanceAutoSave();
startAppRunnerAutoSave();
startTypographyWatcher();
await applyPersistedDirectoryPreferences();

if (typeof window !== 'undefined') {
  (window as { debugContextTokens?: () => void }).debugContextTokens = () => {
    const state = useChatStore.getState();

    if (!state.currentSessionId) {
      console.debug('No active session');
      return;
    }

    const assistantMessages = state.messages.filter((m) => m.info.role === 'assistant');
    if (assistantMessages.length === 0) {
      console.debug('No assistant messages');
      return;
    }

    const lastMessage = assistantMessages[assistantMessages.length - 1];
    const tokens = (lastMessage.info as { tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } }).tokens;

    if (tokens && typeof tokens === 'object') {
      console.debug('Token breakdown:', {
        base: (tokens.input || 0) + (tokens.output || 0) + (tokens.reasoning || 0),
        cache: tokens.cache ? (tokens.cache.read || 0) + (tokens.cache.write || 0) : 0
      });
    }

    console.debug('Context usage:', state.contextUsage);
  };
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeSystemProvider>
      <ThemeProvider>
        <SessionAuthGate>
          <App apis={runtimeAPIs} />
        </SessionAuthGate>
      </ThemeProvider>
    </ThemeSystemProvider>
  </StrictMode>,
);

if (typeof window !== 'undefined') {
  const markRendererReady = () => {
    try {
      window.opencodeDesktop?.markRendererReady?.();
    } catch (error) {
      console.warn('Failed to notify desktop runtime that renderer is ready:', error);
    }
  };

  markRendererReady();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      markRendererReady();
    }
  });
}
