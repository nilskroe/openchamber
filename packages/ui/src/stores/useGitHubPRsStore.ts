import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { BoardColumn, BoardColumnType, PullRequest } from '@/lib/github-repos/types';
import { getInstantCache, setInstantCache, INSTANT_CACHE_KEYS } from '@/lib/instantCache';

// Cache TTL: 5 minutes (data is considered fresh - skip fetch)
const CACHE_TTL_MS = 5 * 60 * 1000;
// Stale TTL: 30 minutes (data can be shown while revalidating)
const STALE_TTL_MS = 30 * 60 * 1000;

const COLUMN_CONFIGS: Array<{ id: BoardColumnType; label: string; color: string }> = [
  { id: 'branches', label: 'Branches', color: '#6B7280' },
  { id: 'behind-prs', label: 'Behind', color: '#F59E0B' },
  { id: 'draft-prs', label: 'Draft', color: '#9CA3AF' },
  { id: 'pending-prs', label: 'Pending', color: '#3B82F6' },
  { id: 'failing-prs', label: 'Failing', color: '#EF4444' },
  { id: 'changes-requested-prs', label: 'Changes Requested', color: '#F97316' },
  { id: 'in-review-prs', label: 'In Review', color: '#8B5CF6' },
  { id: 'ready-to-merge-prs', label: 'Ready to Merge', color: '#10B981' },
  { id: 'merged-prs', label: 'Merged', color: '#6366F1' },
];

// Stable empty columns reference - prevents re-renders when no data
const EMPTY_COLUMNS: BoardColumn[] = COLUMN_CONFIGS.map((config) => ({
  id: config.id,
  label: config.label,
  color: config.color,
  items: [],
}));

// Stable empty data reference
const EMPTY_REPO_DATA: RepoData = { columns: EMPTY_COLUMNS, timestamp: 0, error: null };

// Instant cache structure for localStorage persistence
interface CachedPRData {
  prs: PullRequest[];
  timestamp: number;
}

// Read cached PR data from localStorage for instant display
function readCachedPRData(owner: string, repo: string): CachedPRData | null {
  const key = `${INSTANT_CACHE_KEYS.GITHUB_PRS}:${owner}/${repo}`;
  const cached = getInstantCache<CachedPRData>(key);
  if (!cached || !Array.isArray(cached.prs)) return null;
  // Check if still within stale TTL
  if (Date.now() - cached.timestamp > STALE_TTL_MS) return null;
  return cached;
}

// Write PR data to localStorage for instant loading on next visit
function writeCachedPRData(owner: string, repo: string, prs: PullRequest[]): void {
  const key = `${INSTANT_CACHE_KEYS.GITHUB_PRS}:${owner}/${repo}`;
  setInstantCache(key, { prs, timestamp: Date.now() });
}

function assignPRToColumn(pr: PullRequest): BoardColumnType {
  if (pr.state === 'merged') return 'merged-prs';
  if (pr.isDraft) return 'draft-prs';
  if (pr.mergeable === 'CONFLICTING') return 'behind-prs';
  if (pr.statusCheckRollup === 'FAILURE') return 'failing-prs';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes-requested-prs';
  if (pr.reviewDecision === 'APPROVED' && pr.statusCheckRollup === 'SUCCESS') return 'ready-to-merge-prs';
  if (pr.reviewDecision === 'REVIEW_REQUIRED') return 'in-review-prs';
  return 'pending-prs';
}

function buildColumns(prs: PullRequest[]): BoardColumn[] {
  const columnMap = new Map<BoardColumnType, PullRequest[]>();
  COLUMN_CONFIGS.forEach((config) => columnMap.set(config.id, []));

  prs.forEach((pr) => {
    const columnId = assignPRToColumn(pr);
    columnMap.get(columnId)!.push(pr);
  });

  return COLUMN_CONFIGS.map((config) => ({
    id: config.id,
    label: config.label,
    color: config.color,
    items: columnMap.get(config.id)!.map((pr) => ({ type: 'pr' as const, data: pr })),
  }));
}

interface RepoData {
  columns: BoardColumn[];
  timestamp: number;
  error: string | null;
}

interface FetchState {
  isLoading: boolean;
  isRevalidating: boolean;
}

interface GitHubPRsStore {
  // Data cache: repoKey -> { columns, timestamp, error }
  repos: Map<string, RepoData>;
  // Fetch state: repoKey -> { isLoading, isRevalidating }
  fetchStates: Map<string, FetchState>;
  // In-flight fetch promises to deduplicate requests
  fetchPromises: Map<string, Promise<void>>;

  // Get data for a repo (returns empty columns if not cached)
  getRepoData: (owner: string, repo: string) => RepoData;
  // Get fetch state for a repo
  getFetchState: (owner: string, repo: string) => FetchState;
  // Fetch PRs (with deduplication and stale-while-revalidate)
  fetchPRs: (owner: string, repo: string, force?: boolean) => Promise<void>;
  // Prefetch PRs (silent, no error state)
  prefetchPRs: (owner: string, repo: string) => void;
  // Force refresh
  refreshPRs: (owner: string, repo: string) => Promise<void>;
  // Clear cache for a repo
  invalidateRepo: (owner: string, repo: string) => void;
  // Load from instant cache (called on first access)
  loadFromInstantCache: (owner: string, repo: string) => boolean;
}

function getRepoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

const DEFAULT_FETCH_STATE: FetchState = { isLoading: false, isRevalidating: false };

export const useGitHubPRsStore = create<GitHubPRsStore>()(
  subscribeWithSelector((set, get) => ({
    repos: new Map(),
    fetchStates: new Map(),
    fetchPromises: new Map(),

    loadFromInstantCache: (owner, repo) => {
      const key = getRepoKey(owner, repo);
      const state = get();

      // Already in memory
      if (state.repos.has(key)) return true;

      // Try localStorage
      const cached = readCachedPRData(owner, repo);
      if (cached && cached.prs.length > 0) {
        const columns = buildColumns(cached.prs);
        set((s) => {
          const newRepos = new Map(s.repos);
          newRepos.set(key, { columns, timestamp: cached.timestamp, error: null });
          return { repos: newRepos };
        });
        return true;
      }
      return false;
    },

    getRepoData: (owner, repo) => {
      const key = getRepoKey(owner, repo);
      const state = get();

      // Check memory cache first
      const data = state.repos.get(key);
      if (data) {
        const age = Date.now() - data.timestamp;
        if (age <= STALE_TTL_MS) {
          return data;
        }
      }

      // Try to load from instant cache (localStorage)
      // This hydrates memory from localStorage on first access
      const cached = readCachedPRData(owner, repo);
      if (cached && cached.prs.length > 0) {
        const columns = buildColumns(cached.prs);
        const repoData: RepoData = { columns, timestamp: cached.timestamp, error: null };
        // Hydrate memory cache (async to not block render)
        queueMicrotask(() => {
          set((s) => {
            const newRepos = new Map(s.repos);
            // Only set if not already there (avoid race)
            if (!newRepos.has(key)) {
              newRepos.set(key, repoData);
            }
            return { repos: newRepos };
          });
        });
        return repoData;
      }

      return EMPTY_REPO_DATA;
    },

    getFetchState: (owner, repo) => {
      const key = getRepoKey(owner, repo);
      return get().fetchStates.get(key) ?? DEFAULT_FETCH_STATE;
    },

    fetchPRs: async (owner, repo, force = false) => {
      const key = getRepoKey(owner, repo);
      const state = get();

      // Check if there's already a fetch in progress
      const existingPromise = state.fetchPromises.get(key);
      if (existingPromise) {
        return existingPromise;
      }

      // Try to load from instant cache first (if not in memory)
      state.loadFromInstantCache(owner, repo);

      const existingData = get().repos.get(key);
      const hasData = !!(existingData && Date.now() - existingData.timestamp < STALE_TTL_MS);
      const isFresh = !!(existingData && Date.now() - existingData.timestamp < CACHE_TTL_MS);

      // If fresh and not forced, skip fetch
      if (isFresh && !force) {
        return;
      }

      // Set fetch state
      set((s) => {
        const newFetchStates = new Map(s.fetchStates);
        newFetchStates.set(key, {
          isLoading: !hasData,
          isRevalidating: hasData,
        });
        return { fetchStates: newFetchStates };
      });

      const fetchPromise = (async () => {
        try {
          const response = await fetch(`/api/github/${owner}/${repo}/prs`);

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Failed to fetch PRs' }));
            throw new Error(errorData.message || errorData.error || 'Failed to fetch PRs');
          }

          const data = await response.json();
          const prs: PullRequest[] = data.prs || [];
          const columns = buildColumns(prs);

          // Persist to localStorage for instant loading on next visit
          writeCachedPRData(owner, repo, prs);

          set((s) => {
            const newRepos = new Map(s.repos);
            newRepos.set(key, { columns, timestamp: Date.now(), error: null });
            const newFetchStates = new Map(s.fetchStates);
            newFetchStates.set(key, { isLoading: false, isRevalidating: false });
            const newFetchPromises = new Map(s.fetchPromises);
            newFetchPromises.delete(key);
            return { repos: newRepos, fetchStates: newFetchStates, fetchPromises: newFetchPromises };
          });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to fetch PRs';

          set((s) => {
            const newRepos = new Map(s.repos);
            // Only set error if we don't have cached data
            if (!hasData) {
              newRepos.set(key, { columns: EMPTY_COLUMNS, timestamp: 0, error: errorMessage });
            }
            const newFetchStates = new Map(s.fetchStates);
            newFetchStates.set(key, { isLoading: false, isRevalidating: false });
            const newFetchPromises = new Map(s.fetchPromises);
            newFetchPromises.delete(key);
            return { repos: newRepos, fetchStates: newFetchStates, fetchPromises: newFetchPromises };
          });
        }
      })();

      // Store the promise for deduplication
      set((s) => {
        const newFetchPromises = new Map(s.fetchPromises);
        newFetchPromises.set(key, fetchPromise);
        return { fetchPromises: newFetchPromises };
      });

      return fetchPromise;
    },

    prefetchPRs: (owner, repo) => {
      // Fire and forget - don't await
      get().fetchPRs(owner, repo, false).catch(() => {
        // Silently ignore prefetch errors
      });
    },

    refreshPRs: async (owner, repo) => {
      const key = getRepoKey(owner, repo);
      // Invalidate first
      set((s) => {
        const newRepos = new Map(s.repos);
        const existing = newRepos.get(key);
        if (existing) {
          // Keep data but mark timestamp as 0 to force revalidation
          newRepos.set(key, { ...existing, timestamp: 0 });
        }
        return { repos: newRepos };
      });
      // Then fetch
      return get().fetchPRs(owner, repo, true);
    },

    invalidateRepo: (owner, repo) => {
      const key = getRepoKey(owner, repo);
      set((s) => {
        const newRepos = new Map(s.repos);
        newRepos.delete(key);
        const newFetchStates = new Map(s.fetchStates);
        newFetchStates.delete(key);
        return { repos: newRepos, fetchStates: newFetchStates };
      });
    },
  }))
);

// Selector hooks for optimal re-render performance
// These use stable references to prevent unnecessary re-renders

export function useGitHubRepoColumns(owner: string, repo: string): BoardColumn[] {
  return useGitHubPRsStore((state) => state.getRepoData(owner, repo).columns);
}

export function useGitHubRepoError(owner: string, repo: string): string | null {
  return useGitHubPRsStore((state) => state.getRepoData(owner, repo).error);
}

export function useGitHubRepoFetchState(owner: string, repo: string): FetchState {
  return useGitHubPRsStore((state) => state.getFetchState(owner, repo));
}

// Check if we have cached data (instant or memory) for a repo
export function hasGitHubRepoCachedData(owner: string, repo: string): boolean {
  const state = useGitHubPRsStore.getState();
  const key = getRepoKey(owner, repo);

  // Check memory
  const memData = state.repos.get(key);
  if (memData && Date.now() - memData.timestamp < STALE_TTL_MS) {
    return true;
  }

  // Check localStorage
  const cached = readCachedPRData(owner, repo);
  return !!(cached && cached.prs.length > 0);
}
