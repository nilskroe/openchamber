/**
 * Instant cache using localStorage for synchronous reads.
 *
 * This provides truly instant data loading because localStorage reads are synchronous
 * and happen at module evaluation time, before React even mounts.
 *
 * Use this for data that needs to be available immediately on app start (e.g., sidebar data).
 */

const CACHE_PREFIX = 'oc_instant_';

/**
 * Read a value from localStorage synchronously.
 * Returns null if not found or if localStorage is unavailable.
 */
export function getInstantCache<T>(key: string): T | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Write a value to localStorage.
 * Silently fails if localStorage is unavailable.
 */
export function setInstantCache<T>(key: string, value: T): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // localStorage might be full or disabled - silently ignore
  }
}

/**
 * Remove a value from localStorage.
 */
export function removeInstantCache(key: string): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.removeItem(`${CACHE_PREFIX}${key}`);
  } catch {
    // silently ignore
  }
}

// Cache keys
export const INSTANT_CACHE_KEYS = {
  PROJECTS: 'projects',
  WORKTREES: 'worktrees',
  ACTIVE_PROJECT_ID: 'activeProjectId',
  COLLAPSED_PROJECTS: 'collapsedProjects',
  GITHUB_DETAIL_PAGE: 'githubDetailPage',
  GITHUB_PRS: 'github_prs',
} as const;
