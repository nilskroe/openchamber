import { useState, useCallback, useMemo, useRef } from 'react';
import {
  RiArrowLeftSLine,
  RiRefreshLine,
  RiGitBranchLine,
  RiGithubLine,
  RiSearchLine,
  RiUserLine,
  RiPriceTag3Line,
  RiEyeLine,
  RiEyeOffLine,
  RiCloseLine,
} from '@remixicon/react';
import { toast } from 'sonner';
import { useGitHubRepoPRs } from '@/hooks/useGitHubRepoPRs';
import { createWorktreeSessionForBranch } from '@/lib/worktreeSessionCreator';
import { GitHubRepoBoardColumn, GitHubRepoBoardColumnSkeleton } from './GitHubRepoBoardColumn';
import type { BoardColumn, PullRequest } from '@/lib/github-repos/types';

// Column labels for skeleton display
const SKELETON_COLUMNS = ['Behind', 'Draft', 'Pending', 'Failing', 'In Review', 'Ready'];

interface GitHubRepoDetailPageProps {
  owner: string;
  repo: string;
  projectDirectory?: string;
  onClose: () => void;
}

export function GitHubRepoDetailPage({ owner, repo, projectDirectory, onClose }: GitHubRepoDetailPageProps) {
  const { columns, isLoading, error, refresh, isRevalidating } = useGitHubRepoPRs(owner, repo);
  const [creatingWorktreeFor, setCreatingWorktreeFor] = useState<number | null>(null);
  const creatingRef = useRef(false);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAuthor, setSelectedAuthor] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [hideEmptyColumns, setHideEmptyColumns] = useState(false);

  // Extract unique authors and labels from all PRs
  const { authors, labels } = useMemo(() => {
    const authorSet = new Set<string>();
    const labelSet = new Set<string>();

    columns.forEach((col) => {
      col.items.forEach((item) => {
        if (item.type === 'pr') {
          authorSet.add(item.data.author);
          item.data.labels.forEach((label) => labelSet.add(label));
        }
      });
    });

    return {
      authors: Array.from(authorSet).sort(),
      labels: Array.from(labelSet).sort(),
    };
  }, [columns]);

  // Apply filters to columns
  const filteredColumns = useMemo((): BoardColumn[] => {
    const query = searchQuery.toLowerCase().trim();

    const filtered = columns.map((col) => ({
      ...col,
      items: col.items.filter((item) => {
        if (item.type !== 'pr') return true;
        const pr = item.data;

        // Search filter
        if (query && !pr.title.toLowerCase().includes(query) && !pr.headRefName.toLowerCase().includes(query)) {
          return false;
        }

        // Author filter
        if (selectedAuthor && pr.author !== selectedAuthor) {
          return false;
        }

        // Label filter
        if (selectedLabel && !pr.labels.includes(selectedLabel)) {
          return false;
        }

        return true;
      }),
    }));

    // Optionally hide empty columns
    if (hideEmptyColumns) {
      return filtered.filter((col) => col.items.length > 0);
    }

    return filtered;
  }, [columns, searchQuery, selectedAuthor, selectedLabel, hideEmptyColumns]);

  const hasActiveFilters = searchQuery || selectedAuthor || selectedLabel;

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedAuthor(null);
    setSelectedLabel(null);
  }, []);

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
      // Pass the PR number to enable fetching branches from forks
      await createWorktreeSessionForBranch(projectDirectory, pr.headRefName, pr.number);
    } finally {
      creatingRef.current = false;
      setCreatingWorktreeFor(null);
    }
  }, [projectDirectory]);

  const totalPRs = useMemo(
    () => columns.reduce((sum, col) => sum + col.items.length, 0),
    [columns]
  );

  const filteredPRs = useMemo(
    () => filteredColumns.reduce((sum, col) => sum + col.items.length, 0),
    [filteredColumns]
  );

  const onCreateWorktree = projectDirectory ? handleCreateWorktree : undefined;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex flex-col border-b border-border shrink-0">
        {/* Top row: Title and refresh */}
        <div className="flex items-center gap-3 px-4 py-3">
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
              {hasActiveFilters ? `${filteredPRs}/${totalPRs}` : totalPRs} PR{totalPRs !== 1 ? 's' : ''}
            </span>
          )}

          <div className="flex-1" />

          <button
            onClick={refresh}
            disabled={isLoading || isRevalidating}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
          >
            <RiRefreshLine className={`h-4 w-4 ${isLoading || isRevalidating ? 'animate-spin' : ''}`} />
            {isRevalidating ? 'Updating...' : 'Refresh'}
          </button>
        </div>

        {/* Filter row */}
        {!isLoading && !error && totalPRs > 0 && (
          <div className="flex items-center gap-2 px-4 pb-3 flex-wrap">
            {/* Search */}
            <div className="relative">
              <RiSearchLine className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Search PRs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-48 rounded-md border border-border bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Author filter */}
            {authors.length > 0 && (
              <div className="relative">
                <RiUserLine className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <select
                  value={selectedAuthor ?? ''}
                  onChange={(e) => setSelectedAuthor(e.target.value || null)}
                  className="h-8 appearance-none rounded-md border border-border bg-background pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
                >
                  <option value="">All authors</option>
                  {authors.map((author) => (
                    <option key={author} value={author}>
                      {author}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Label filter */}
            {labels.length > 0 && (
              <div className="relative">
                <RiPriceTag3Line className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <select
                  value={selectedLabel ?? ''}
                  onChange={(e) => setSelectedLabel(e.target.value || null)}
                  className="h-8 appearance-none rounded-md border border-border bg-background pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
                >
                  <option value="">All labels</option>
                  {labels.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Hide empty columns toggle */}
            <button
              onClick={() => setHideEmptyColumns((prev) => !prev)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors ${
                hideEmptyColumns
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
              title={hideEmptyColumns ? 'Show empty columns' : 'Hide empty columns'}
            >
              {hideEmptyColumns ? <RiEyeOffLine className="h-4 w-4" /> : <RiEyeLine className="h-4 w-4" />}
              <span className="hidden sm:inline">{hideEmptyColumns ? 'Hidden' : 'Show all'}</span>
            </button>

            {/* Clear filters */}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <RiCloseLine className="h-4 w-4" />
                Clear
              </button>
            )}
          </div>
        )}
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
          <div className="h-full overflow-x-auto overflow-y-hidden">
            <div className="flex h-full gap-3 p-4">
              {SKELETON_COLUMNS.map((label) => (
                <GitHubRepoBoardColumnSkeleton key={label} label={label} />
              ))}
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
              {filteredColumns.map((column) => (
                <GitHubRepoBoardColumn
                  key={column.id}
                  column={column}
                  onCreateWorktree={onCreateWorktree}
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
