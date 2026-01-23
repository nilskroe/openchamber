import React from 'react';
import { RiFolderTransferLine } from '@remixicon/react';
import type { BoardItem, PullRequest } from '@/lib/github-repos/types';

interface GitHubRepoBoardCardProps {
  item: BoardItem;
  onClick?: () => void;
  onCreateWorktree?: (pr: PullRequest) => void;
  isCreatingWorktree?: boolean;
}

function getStatusColor(status?: string | null): string {
  if (!status) return 'bg-gray-400';
  switch (status) {
    case 'SUCCESS':
      return 'bg-green-500';
    case 'FAILURE':
      return 'bg-red-500';
    case 'PENDING':
    case 'NEUTRAL':
      return 'bg-yellow-500';
    default:
      return 'bg-gray-400';
  }
}

export const GitHubRepoBoardCard = React.memo(function GitHubRepoBoardCard({ item, onClick, onCreateWorktree, isCreatingWorktree }: GitHubRepoBoardCardProps) {
  if (item.type === 'branch') {
    return (
      <div
        className="cursor-pointer rounded-md border border-border bg-card p-3 transition-colors hover:bg-accent"
        onClick={onClick}
      >
        <div className="text-sm font-medium text-foreground">{item.data.name}</div>
        <div className="mt-1 text-xs text-muted-foreground">{item.data.commit.slice(0, 7)}</div>
      </div>
    );
  }

  const pr = item.data;
  const statusColor = getStatusColor(pr.statusCheckRollup);

  return (
    <div
      className="rounded-md border border-border bg-card p-3 transition-colors hover:bg-accent"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{pr.title}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>#{pr.number}</span>
            <span className="truncate">{pr.headRefName}</span>
          </div>
        </div>
        <div className={`h-2 w-2 rounded-full flex-shrink-0 mt-1.5 ${statusColor}`} />
      </div>

      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
          <span className="truncate">{pr.author}</span>
          {pr.labels.length > 0 && (
            <>
              <span>·</span>
              <div className="flex gap-1 min-w-0">
                {pr.labels.slice(0, 2).map((label) => (
                  <span
                    key={label}
                    className="rounded-full bg-muted px-1.5 py-0.5 text-xs truncate max-w-[80px]"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {onCreateWorktree && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCreateWorktree(pr);
            }}
            disabled={isCreatingWorktree}
            className="ml-2 flex-shrink-0 inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Create worktree"
          >
            {isCreatingWorktree ? (
              <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
            ) : (
              <RiFolderTransferLine className="h-3 w-3" />
            )}
          </button>
        )}
      </div>
    </div>
  );
});
