/**
 * File-based settings storage for ~/openchamber/settings.json.
 *
 * Provides a Zustand-compatible StateStorage interface that persists all store
 * state to a single JSON file instead of localStorage. The file is read once on
 * startup (cached in memory), and writes are debounced to avoid thrashing disk I/O.
 */

import type { StateStorage } from 'zustand/middleware';
import type { FilesAPI, RuntimeAPIs } from '@/lib/api/types';
import { joinPath } from '@/lib/paths';

const SETTINGS_FILENAME = 'settings.json';
const OPENCHAMBER_DIR = 'openchamber';
const WRITE_DEBOUNCE_MS = 300;

// In-memory cache of the entire settings file content
let cache: Record<string, string> = {};
let initialized = false;
let homeDir: string | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWrite = false;

// Promise that resolves once the file is loaded (used for async getItem)
let initPromise: Promise<void> | null = null;
let initResolve: (() => void) | null = null;

/**
 * Get the runtime Files API if available (Desktop/VSCode).
 */
function getRuntimeFilesAPI(): FilesAPI | null {
  if (typeof window === 'undefined') return null;
  const apis = (window as typeof window & { __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs }).__OPENCHAMBER_RUNTIME_APIS__;
  if (apis?.files) {
    return apis.files;
  }
  return null;
}

/**
 * Get the base URL for web API calls.
 */
function getBaseUrl(): string {
  const defaultBaseUrl = import.meta.env.VITE_OPENCODE_URL || '/api';
  if (defaultBaseUrl.startsWith('/')) {
    return defaultBaseUrl;
  }
  return defaultBaseUrl;
}

/**
 * Determine the home directory from available sources.
 */
function resolveHomeDirectory(): string | null {
  if (homeDir) return homeDir;

  if (typeof window === 'undefined') return null;

  // Check embedded home directory
  const embedded = (window as typeof window & { __OPENCHAMBER_HOME__?: string }).__OPENCHAMBER_HOME__;
  if (embedded && embedded.length > 0) {
    homeDir = embedded;
    return homeDir;
  }

  // Check desktop API
  const desktop = (window as typeof window & { opencodeDesktop?: { homeDirectory?: string } }).opencodeDesktop;
  if (desktop?.homeDirectory && desktop.homeDirectory.length > 0) {
    homeDir = desktop.homeDirectory;
    return homeDir;
  }

  // Check localStorage fallback
  try {
    const stored = localStorage.getItem('homeDirectory');
    if (stored && stored !== '/') {
      homeDir = stored;
      return homeDir;
    }
  } catch {
    // ignored
  }

  return null;
}

/**
 * Build the full path to ~/openchamber/settings.json.
 */
function getSettingsPath(): string | null {
  const home = resolveHomeDirectory();
  if (!home) return null;
  return joinPath(joinPath(home, OPENCHAMBER_DIR), SETTINGS_FILENAME);
}

/**
 * Read the settings file from disk.
 */
async function readSettingsFile(): Promise<Record<string, string>> {
  const settingsPath = getSettingsPath();
  if (!settingsPath) return {};

  try {
    const runtimeFiles = getRuntimeFilesAPI();
    if (runtimeFiles?.readFile) {
      const result = await runtimeFiles.readFile(settingsPath);
      if (!result.content.trim()) return {};
      const parsed = JSON.parse(result.content);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed as Record<string, string>;
    }

    // Web API fallback
    const response = await fetch(`${getBaseUrl()}/fs/read?path=${encodeURIComponent(settingsPath)}`);
    if (!response.ok) return {};
    const text = await response.text();
    if (!text.trim()) return {};
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string>;
  } catch {
    // File doesn't exist yet or is invalid — start fresh
    return {};
  }
}

/**
 * Write the entire settings cache to disk.
 */
async function writeSettingsFile(): Promise<void> {
  const settingsPath = getSettingsPath();
  if (!settingsPath) return;

  const content = JSON.stringify(cache, null, 2);

  try {
    const runtimeFiles = getRuntimeFilesAPI();
    if (runtimeFiles?.writeFile) {
      await runtimeFiles.writeFile(settingsPath, content);
      return;
    }

    // Web API fallback
    await fetch(`${getBaseUrl()}/fs/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: settingsPath, content }),
    });
  } catch (error) {
    console.warn('[settingsStorage] Failed to write settings file:', error);
  }
}

/**
 * Schedule a debounced write to disk.
 */
function scheduleWrite(): void {
  pendingWrite = true;
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
  }
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (pendingWrite) {
      pendingWrite = false;
      void writeSettingsFile();
    }
  }, WRITE_DEBOUNCE_MS);
}

/**
 * Ensure the init promise exists. Creates one if needed.
 */
function ensureInitPromise(): Promise<void> {
  if (!initPromise) {
    initPromise = new Promise<void>((resolve) => {
      initResolve = resolve;
    });
  }
  return initPromise;
}

/**
 * Initialize the settings storage by reading the file from disk.
 * Must be called early in the app lifecycle. Safe to call multiple times.
 */
export async function initSettingsStorage(home?: string): Promise<void> {
  if (initialized) return;

  if (home) {
    homeDir = home;
  }

  cache = await readSettingsFile();
  initialized = true;

  // Resolve any pending getItem calls that are waiting for initialization
  if (initResolve) {
    initResolve();
  }
}

/**
 * Force a flush of any pending writes (useful before app close).
 */
export async function flushSettingsStorage(): Promise<void> {
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (pendingWrite) {
    pendingWrite = false;
    await writeSettingsFile();
  }
}

/**
 * Get a raw value from the settings cache (for non-Zustand consumers like useProjectsStore).
 */
export function getSettingsValue(key: string): string | null {
  if (!initialized) return null;
  const value = cache[key];
  return value !== undefined ? value : null;
}

/**
 * Set a raw value in the settings cache (for non-Zustand consumers like useProjectsStore).
 */
export function setSettingsValue(key: string, value: string): void {
  cache[key] = value;
  scheduleWrite();
}

/**
 * Remove a value from the settings cache.
 */
export function removeSettingsValue(key: string): void {
  delete cache[key];
  scheduleWrite();
}

/**
 * Whether the storage has been initialized.
 */
export function isSettingsStorageReady(): boolean {
  return initialized;
}

/**
 * Zustand-compatible StateStorage implementation backed by ~/openchamber/settings.json.
 *
 * getItem returns a Promise when not yet initialized, which makes Zustand's
 * persist middleware defer hydration until the settings file is loaded.
 *
 * Usage: createJSONStorage(() => settingsFileStorage)
 */
export const settingsFileStorage: StateStorage = {
  getItem(name: string): string | null | Promise<string | null> {
    if (initialized) {
      return getSettingsValue(name);
    }
    // Defer hydration until init completes
    return ensureInitPromise().then(() => getSettingsValue(name));
  },
  setItem(name: string, value: string): void {
    setSettingsValue(name, value);
  },
  removeItem(name: string): void {
    removeSettingsValue(name);
  },
};
