import React from 'react';

type CleanupResult = {
  deletedIds: string[];
  failedIds: string[];
  skippedReason?: 'disabled' | 'loading' | 'cooldown' | 'no-candidates' | 'running';
};

type CleanupOptions = {
  autoRun?: boolean;
};

/**
 * No-op in one-session-per-worktree model.
 * Session lifecycle is tied to worktree lifecycle.
 */
export const useSessionAutoCleanup = (_options?: CleanupOptions) => {
  const runCleanup = React.useCallback(
    async (_opts?: { force?: boolean }): Promise<CleanupResult> => {
      return { deletedIds: [], failedIds: [], skippedReason: 'disabled' };
    },
    []
  );

  return {
    candidates: [] as string[],
    isRunning: false,
    runCleanup,
    keepRecentCount: 5,
  };
};
