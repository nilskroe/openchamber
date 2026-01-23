import React from 'react';
import type { BoardColumn, PullRequest } from '@/lib/github-repos/types';
import { GitHubRepoBoardCard } from './GitHubRepoBoardCard';
import { Skeleton } from '@/components/ui/skeleton';

interface GitHubRepoBoardColumnProps {
  column: BoardColumn;
  onCreateWorktree?: (pr: PullRequest) => void;
  creatingWorktreeFor?: number | null;
}

export const GitHubRepoBoardColumn = React.memo(function GitHubRepoBoardColumn({ column, onCreateWorktree, creatingWorktreeFor }: GitHubRepoBoardColumnProps) {
  return (
    <div className="flex min-w-[280px] max-w-[280px] flex-col rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-sm font-medium text-foreground">{column.label}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {column.items.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {column.items.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No PRs
          </div>
        ) : (
          <div className="space-y-2">
            {column.items.map((item) => (
              <GitHubRepoBoardCard
                key={item.type === 'pr' ? `pr-${item.data.number}` : `branch-${item.data.name}`}
                item={item}
                onCreateWorktree={onCreateWorktree}
                isCreatingWorktree={item.type === 'pr' && creatingWorktreeFor === item.data.number}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

// Skeleton card for loading state
function SkeletonCard() {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <Skeleton className="h-2 w-2 rounded-full" />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

// Skeleton column for loading state
interface SkeletonColumnProps {
  label: string;
  cardCount?: number;
}

export function GitHubRepoBoardColumnSkeleton({ label, cardCount = 2 }: SkeletonColumnProps) {
  return (
    <div className="flex min-w-[280px] max-w-[280px] flex-col rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-sm font-medium text-foreground">{label}</h3>
        <Skeleton className="h-5 w-5 rounded-full" />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-2">
          {Array.from({ length: cardCount }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
