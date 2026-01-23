import { useState, useCallback } from 'react';
import { RiRefreshLine, RiGitBranchLine } from '@remixicon/react';
import { toast } from 'sonner';
import { useGitHubRepoPRs } from '@/hooks/useGitHubRepoPRs';
import { createWorktreeSessionForBranch } from '@/lib/worktreeSessionCreator';
import { GitHubRepoBoardColumn } from './GitHubRepoBoardColumn';
import type { PullRequest } from '@/lib/github-repos/types';

interface GitHubRepoBoardProps {
  owner: string;
  repo: string;
  projectDirectory?: string;
}

export function GitHubRepoBoard({ owner, repo, projectDirectory }: GitHubRepoBoardProps) {
  const { columns, isLoading, error, refresh } = useGitHubRepoPRs(owner, repo);
  const [creatingWorktreeFor, setCreatingWorktreeFor] = useState<number | null>(null);

  const handleCreateWorktree = useCallback(async (pr: PullRequest) => {
    if (!projectDirectory) {
      toast.error('Cannot create worktree', {
        description: 'Project directory not available.',
      });
      return;
    }

    if (creatingWorktreeFor !== null) return;

    setCreatingWorktreeFor(pr.number);
    try {
      await createWorktreeSessionForBranch(projectDirectory, pr.headRefName);
    } finally {
      setCreatingWorktreeFor(null);
    }
  }, [projectDirectory, creatingWorktreeFor]);

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

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Loading PRs...
        </div>
      </div>
    );
  }

  const totalPRs = columns.reduce((sum, col) => sum + col.items.length, 0);

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
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
        >
          <RiRefreshLine className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Board columns */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full gap-3 p-4">
          {columns.map((column) => (
            <GitHubRepoBoardColumn
              key={column.id}
              column={column}
              onCreateWorktree={projectDirectory ? handleCreateWorktree : undefined}
              creatingWorktreeFor={creatingWorktreeFor}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
