import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { settingsFileStorage } from '@/lib/settingsStorage';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';

export type AppRunnerStatus = 'stopped' | 'starting' | 'running' | 'crashed';

export interface DetectedUrl {
  url: string;
  port: number;
  detectedAt: number;
}

interface DirectoryRunnerState {
  status: AppRunnerStatus;
  terminalSessionId: string | null;
  detectedUrls: DetectedUrl[];
  lastExitCode: number | null;
  /** Prevents duplicate start/stop calls */
  isTransitioning: boolean;
  /** Error message if start/stop failed */
  error: string | null;
}

const DEFAULT_DIR_STATE: DirectoryRunnerState = {
  status: 'stopped',
  terminalSessionId: null,
  detectedUrls: [],
  lastExitCode: null,
  isTransitioning: false,
  error: null,
};

interface AppRunnerStore {
  // Global settings
  enabled: boolean;
  command: string;

  // Per-directory runtime state
  directoryStates: Record<string, DirectoryRunnerState>;

  // Settings
  setEnabled: (enabled: boolean) => void;
  setCommand: (command: string) => void;

  // Per-directory state accessors
  getDirectoryState: (directory: string) => DirectoryRunnerState;
  setStatus: (directory: string, status: AppRunnerStatus) => void;
  setTerminalSessionId: (directory: string, sessionId: string | null) => void;
  addDetectedUrl: (directory: string, url: string, port: number) => void;
  clearDetectedUrls: (directory: string) => void;
  setLastExitCode: (directory: string, code: number | null) => void;
  resetDirectory: (directory: string) => void;
  setError: (directory: string, error: string | null) => void;
  setTransitioning: (directory: string, isTransitioning: boolean) => void;

  // Core actions - can be called from anywhere (MainLayout, AppRunnerTerminal, etc.)
  startRunner: (directory: string) => Promise<string | null>;
  stopRunner: (directory: string) => Promise<void>;
  toggleRunner: (directory: string) => Promise<void>;
}

const URL_REGEX = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)(?:\/[^\s]*)?/g;

export const parseUrlsFromText = (text: string): DetectedUrl[] => {
  const urls: DetectedUrl[] = [];
  const seen = new Set<string>();

  let match;
  while ((match = URL_REGEX.exec(text)) !== null) {
    const url = match[0];
    const port = parseInt(match[1], 10);

    if (!seen.has(url)) {
      seen.add(url);
      urls.push({ url, port, detectedAt: Date.now() });
    }
  }

  URL_REGEX.lastIndex = 0;
  return urls;
};

/**
 * Helper to update a specific directory's state
 */
const updateDirState = (
  state: AppRunnerStore,
  directory: string,
  updates: Partial<DirectoryRunnerState>
): { directoryStates: Record<string, DirectoryRunnerState> } => ({
  directoryStates: {
    ...state.directoryStates,
    [directory]: {
      ...(state.directoryStates[directory] ?? DEFAULT_DIR_STATE),
      ...updates,
    },
  },
});

export const useAppRunnerStore = create<AppRunnerStore>()(
  persist(
    (set, get) => ({
      enabled: true,
      command: 'bun run dev',
      directoryStates: {},

      setEnabled: (enabled) => set({ enabled }),
      setCommand: (command) => set({ command }),

      getDirectoryState: (directory) => {
        return get().directoryStates[directory] ?? DEFAULT_DIR_STATE;
      },

      setStatus: (directory, status) => set((state) => updateDirState(state, directory, { status })),

      setTerminalSessionId: (directory, terminalSessionId) =>
        set((state) => updateDirState(state, directory, { terminalSessionId })),

      addDetectedUrl: (directory, url, port) =>
        set((state) => {
          const dirState = state.directoryStates[directory] ?? DEFAULT_DIR_STATE;
          const exists = dirState.detectedUrls.some((u) => u.url === url);
          if (exists) return state;
          return updateDirState(state, directory, {
            detectedUrls: [...dirState.detectedUrls, { url, port, detectedAt: Date.now() }],
          });
        }),

      clearDetectedUrls: (directory) => set((state) => updateDirState(state, directory, { detectedUrls: [] })),

      setLastExitCode: (directory, lastExitCode) =>
        set((state) => updateDirState(state, directory, { lastExitCode })),

      resetDirectory: (directory) =>
        set((state) => ({
          directoryStates: {
            ...state.directoryStates,
            [directory]: { ...DEFAULT_DIR_STATE },
          },
        })),

      setError: (directory, error) => set((state) => updateDirState(state, directory, { error })),

      setTransitioning: (directory, isTransitioning) =>
        set((state) => updateDirState(state, directory, { isTransitioning })),

      /**
       * Start the App Runner for a directory.
       * Creates a new terminal session and sends the configured command.
       * Returns the session ID on success, null on failure.
       */
      startRunner: async (directory: string): Promise<string | null> => {
        const state = get();

        // Check preconditions
        if (!state.enabled) {
          console.warn('[AppRunner] Cannot start: App Runner is disabled');
          return null;
        }

        if (!directory) {
          console.warn('[AppRunner] Cannot start: No directory provided');
          return null;
        }

        const dirState = state.directoryStates[directory] ?? DEFAULT_DIR_STATE;

        // Prevent duplicate starts
        if (dirState.isTransitioning) {
          console.warn('[AppRunner] Cannot start: Already transitioning');
          return null;
        }

        if (dirState.status === 'running' || dirState.status === 'starting') {
          console.warn('[AppRunner] Cannot start: Already running or starting');
          return dirState.terminalSessionId;
        }

        // Get terminal API
        const apis = getRegisteredRuntimeAPIs();
        if (!apis?.terminal) {
          console.error('[AppRunner] Cannot start: Terminal API not available');
          set((s) => updateDirState(s, directory, { error: 'Terminal API not available' }));
          return null;
        }

        // Begin transition
        set((s) =>
          updateDirState(s, directory, {
            isTransitioning: true,
            error: null,
            status: 'starting',
            detectedUrls: [],
          })
        );

        try {
          // Create terminal session
          const session = await apis.terminal.createSession({ cwd: directory });

          // Store the session ID immediately
          set((s) =>
            updateDirState(s, directory, {
              terminalSessionId: session.sessionId,
            })
          );

          // Dispatch event so AppRunnerTerminal can connect to the stream
          document.dispatchEvent(
            new CustomEvent('app-runner-session-created', {
              detail: { directory, sessionId: session.sessionId },
            })
          );

          // Small delay before sending command to ensure stream is connected
          await new Promise((resolve) => setTimeout(resolve, 150));

          // Send the command
          const command = get().command;
          await apis.terminal.sendInput(session.sessionId, command + '\n');

          // Update status to running
          set((s) =>
            updateDirState(s, directory, {
              status: 'running',
              isTransitioning: false,
            })
          );

          return session.sessionId;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Failed to start terminal session';
          console.error('[AppRunner] Failed to start:', error);
          set((s) =>
            updateDirState(s, directory, {
              status: 'crashed',
              isTransitioning: false,
              error: errorMsg,
              terminalSessionId: null,
            })
          );
          return null;
        }
      },

      /**
       * Stop the App Runner for a directory.
       * Sends Ctrl+C and closes the terminal session.
       */
      stopRunner: async (directory: string): Promise<void> => {
        const state = get();

        if (!directory) {
          console.warn('[AppRunner] Cannot stop: No directory provided');
          return;
        }

        const dirState = state.directoryStates[directory] ?? DEFAULT_DIR_STATE;
        const sessionId = dirState.terminalSessionId;

        // Prevent duplicate stops
        if (dirState.isTransitioning) {
          console.warn('[AppRunner] Cannot stop: Already transitioning');
          return;
        }

        if (!sessionId) {
          // No session to stop, just reset state
          set((s) =>
            updateDirState(s, directory, {
              status: 'stopped',
              error: null,
            })
          );
          return;
        }

        // Get terminal API
        const apis = getRegisteredRuntimeAPIs();
        if (!apis?.terminal) {
          console.error('[AppRunner] Cannot stop: Terminal API not available');
          // Still clear the session ID since we can't interact with it
          set((s) =>
            updateDirState(s, directory, {
              status: 'stopped',
              terminalSessionId: null,
              error: 'Terminal API not available',
            })
          );
          return;
        }

        // Begin transition
        set((s) => updateDirState(s, directory, { isTransitioning: true }));

        try {
          // Send Ctrl+C to interrupt the process
          await apis.terminal.sendInput(sessionId, '\x03');

          // Wait a bit for the process to terminate
          await new Promise((resolve) => setTimeout(resolve, 300));

          // Close the terminal session
          await apis.terminal.close(sessionId);
        } catch (error) {
          console.warn('[AppRunner] Error during stop (may be normal):', error);
        }

        // Dispatch event so AppRunnerTerminal can clean up
        document.dispatchEvent(
          new CustomEvent('app-runner-session-closed', {
            detail: { directory, sessionId },
          })
        );

        // Always update state to stopped
        set((s) =>
          updateDirState(s, directory, {
            status: 'stopped',
            terminalSessionId: null,
            isTransitioning: false,
            error: null,
          })
        );
      },

      /**
       * Toggle the App Runner for a directory.
       * Starts if stopped/crashed, stops if running/starting.
       */
      toggleRunner: async (directory: string): Promise<void> => {
        const state = get();
        const dirState = state.directoryStates[directory] ?? DEFAULT_DIR_STATE;

        if (dirState.status === 'running' || dirState.status === 'starting') {
          await state.stopRunner(directory);
        } else {
          await state.startRunner(directory);
        }
      },
    }),
    {
      name: 'openchamber-app-runner',
      storage: createJSONStorage(() => settingsFileStorage),
      partialize: (state) => ({
        enabled: state.enabled,
        command: state.command,
      }),
    }
  )
);
