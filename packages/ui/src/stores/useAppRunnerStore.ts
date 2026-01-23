import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getSafeStorage } from './utils/safeStorage';

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
}

const DEFAULT_DIR_STATE: DirectoryRunnerState = {
  status: 'stopped',
  terminalSessionId: null,
  detectedUrls: [],
  lastExitCode: null,
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

export const useAppRunnerStore = create<AppRunnerStore>()(
  persist(
    (set, get) => ({
      enabled: false,
      command: 'bun run dev',
      directoryStates: {},

      setEnabled: (enabled) => set({ enabled }),
      setCommand: (command) => set({ command }),

      getDirectoryState: (directory) => {
        return get().directoryStates[directory] ?? DEFAULT_DIR_STATE;
      },

      setStatus: (directory, status) => set((state) => ({
        directoryStates: {
          ...state.directoryStates,
          [directory]: {
            ...(state.directoryStates[directory] ?? DEFAULT_DIR_STATE),
            status,
          },
        },
      })),

      setTerminalSessionId: (directory, terminalSessionId) => set((state) => ({
        directoryStates: {
          ...state.directoryStates,
          [directory]: {
            ...(state.directoryStates[directory] ?? DEFAULT_DIR_STATE),
            terminalSessionId,
          },
        },
      })),

      addDetectedUrl: (directory, url, port) => set((state) => {
        const dirState = state.directoryStates[directory] ?? DEFAULT_DIR_STATE;
        const exists = dirState.detectedUrls.some(u => u.url === url);
        if (exists) return state;
        return {
          directoryStates: {
            ...state.directoryStates,
            [directory]: {
              ...dirState,
              detectedUrls: [...dirState.detectedUrls, { url, port, detectedAt: Date.now() }],
            },
          },
        };
      }),

      clearDetectedUrls: (directory) => set((state) => ({
        directoryStates: {
          ...state.directoryStates,
          [directory]: {
            ...(state.directoryStates[directory] ?? DEFAULT_DIR_STATE),
            detectedUrls: [],
          },
        },
      })),

      setLastExitCode: (directory, lastExitCode) => set((state) => ({
        directoryStates: {
          ...state.directoryStates,
          [directory]: {
            ...(state.directoryStates[directory] ?? DEFAULT_DIR_STATE),
            lastExitCode,
          },
        },
      })),

      resetDirectory: (directory) => set((state) => ({
        directoryStates: {
          ...state.directoryStates,
          [directory]: { ...DEFAULT_DIR_STATE },
        },
      })),
    }),
    {
      name: 'openchamber-app-runner',
      storage: createJSONStorage(() => getSafeStorage()),
      partialize: (state) => ({
        enabled: state.enabled,
        command: state.command,
      }),
    }
  )
);
