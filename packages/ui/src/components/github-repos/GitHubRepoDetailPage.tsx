import { useState, useCallback } from 'react';
import { RiArrowLeftSLine, RiRefreshLine, RiGitBranchLine, RiGithubLine } from '@remixicon/react';
import { toast } from 'sonner';
import { useGitHubRepoPRs } from '@/hooks/useGitHubRepoPRs';
import { createWorktreeSessionForBranch } from '@/lib/worktreeSessionCreator';
import { GitHubRepoBoardColumn } from './GitHubRepoBoardColumn';
import type { PullRequest } from '@/lib/github-repos/types';

interface GitHubRepoDetailPageProps {
  owner: string;
  repo: string;
  projectDirectory?: string;
  onClose: () => void;
}

export function GitHubRepoDetailPage({ owner, repo, projectDirectory, onClose }: GitHubRepoDetailPageProps) {
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

  const totalPRs = columns.reduce((sum, col) => sum + col.items.length, 0);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 shrink-0">
        <button
          onClick={onClose}
          className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title="Back"
        >
          <RiArrowLeftSLine className="h-5 w-5" />
        </button>

        <RiGithubLine className="h-5 w-5 text-muted-foreground" />

        <h1 className="text-base font-semibold text-foreground">
          {owner}/{repo}
        </h1>

        {!isLoading && !error && totalPRs > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {totalPRs} PR{totalPRs !== 1 ? 's' : ''}
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={refresh}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
        >
          <RiRefreshLine className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {error ? (
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
        ) : isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Loading PRs...
            </div>
          </div>
        ) : totalPRs === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
            <RiGitBranchLine className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No pull requests found</p>
          </div>
        ) : (
          <div className="h-full overflow-x-auto overflow-y-hidden">
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
        )}
      </div>
    </div>
  );
}
