import { useState, useCallback, useMemo, useRef } from 'react';
import { RiRefreshLine, RiGitBranchLine } from '@remixicon/react';
import { toast } from 'sonner';
import { useGitHubRepoPRs } from '@/hooks/useGitHubRepoPRs';
import { createWorktreeSessionForBranch } from '@/lib/worktreeSessionCreator';
import { GitHubRepoBoardColumn, GitHubRepoBoardColumnSkeleton } from './GitHubRepoBoardColumn';
import type { PullRequest } from '@/lib/github-repos/types';

// Column labels for skeleton display
const SKELETON_COLUMNS = ['Behind', 'Draft', 'Pending', 'Failing', 'In Review', 'Ready'];

interface GitHubRepoBoardProps {
  owner: string;
  repo: string;
  projectDirectory?: string;
}

export function GitHubRepoBoard({ owner, repo, projectDirectory }: GitHubRepoBoardProps) {
  const { columns, isLoading, error, refresh, isRevalidating } = useGitHubRepoPRs(owner, repo);
  const [creatingWorktreeFor, setCreatingWorktreeFor] = useState<number | null>(null);
  const creatingRef = useRef(false);

  const handleCreateWorktree = useCallback(async (pr: PullRequest) => {
    if (!projectDirectory) {
      toast.error('Cannot create worktree', {
        description: 'Project directory not available.',
      });
      return;
    }

    if (creatingRef.current) return;

    creatingRef.current = true;
    setCreatingWorktreeFor(pr.number);
    try {
      await createWorktreeSessionForBranch(projectDirectory, pr.headRefName);
    } finally {
      creatingRef.current = false;
      setCreatingWorktreeFor(null);
    }
  }, [projectDirectory]);

  const totalPRs = useMemo(
    () => columns.reduce((sum, col) => sum + col.items.length, 0),
    [columns]
  );

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <div className="text-center">
          <p className="text-sm font-medium text-destructive">Failed to load PRs</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        </div>
        <button
          onClick={refresh}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <RiRefreshLine className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  // Show skeleton columns while loading (instead of just a spinner)
  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        {/* Header skeleton */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <RiGitBranchLine className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">
              {owner}/{repo}
            </h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Loading...
            </span>
          </div>
          <button
            disabled
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground opacity-50"
          >
            <RiRefreshLine className="h-4 w-4 animate-spin" />
            Loading...
          </button>
        </div>

        {/* Skeleton columns */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full gap-3 p-4">
            {SKELETON_COLUMNS.map((label) => (
              <GitHubRepoBoardColumnSkeleton key={label} label={label} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (totalPRs === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <RiGitBranchLine className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No pull requests found</p>
        <button
          onClick={refresh}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <RiRefreshLine className="h-4 w-4" />
          Refresh
        </button>
      </div>
    );
  }

  const onCreateWorktree = projectDirectory ? handleCreateWorktree : undefined;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <RiGitBranchLine className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">
            {owner}/{repo}
          </h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {totalPRs} PR{totalPRs !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={isRevalidating}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
        >
          <RiRefreshLine className={`h-4 w-4 ${isRevalidating ? 'animate-spin' : ''}`} />
          {isRevalidating ? 'Updating...' : 'Refresh'}
        </button>
      </div>

      {/* Board columns */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full gap-3 p-4">
          {columns.map((column) => (
            <GitHubRepoBoardColumn
              key={column.id}
              column={column}
              onCreateWorktree={onCreateWorktree}
              creatingWorktreeFor={creatingWorktreeFor}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
