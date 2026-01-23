import { useEffect } from 'react';
import type { BoardColumn } from '@/lib/github-repos/types';
import {
  useGitHubPRsStore,
  useGitHubRepoColumns,
  useGitHubRepoError,
  useGitHubRepoFetchState,
} from '@/stores/useGitHubPRsStore';

interface UseGitHubRepoPRsResult {
  columns: BoardColumn[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  isRevalidating: boolean;
}

export function useGitHubRepoPRs(owner: string, repo: string): UseGitHubRepoPRsResult {
  // Subscribe to store slices (only re-render when these change)
  const columns = useGitHubRepoColumns(owner, repo);
  const error = useGitHubRepoError(owner, repo);
  const { isLoading, isRevalidating } = useGitHubRepoFetchState(owner, repo);

  // Get store actions (these are stable references)
  const fetchPRs = useGitHubPRsStore((state) => state.fetchPRs);
  const refreshPRs = useGitHubPRsStore((state) => state.refreshPRs);

  // Trigger fetch on mount (the store handles deduplication and caching)
  useEffect(() => {
    if (owner && repo) {
      fetchPRs(owner, repo);
    }
  }, [owner, repo, fetchPRs]);

  // Stable refresh callback
  const refresh = () => {
    refreshPRs(owner, repo);
  };

  return { columns, isLoading, error, refresh, isRevalidating };
}

// Export prefetch function for use in hover handlers
export function prefetchGitHubPRs(owner: string, repo: string): void {
  useGitHubPRsStore.getState().prefetchPRs(owner, repo);
}
