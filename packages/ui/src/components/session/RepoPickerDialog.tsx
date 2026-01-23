import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  RiGitRepositoryLine,
  RiSearchLine,
  RiLoader4Line,
  RiLockLine,
  RiGlobalLine,
  RiAlertLine,
} from '@remixicon/react';
import { cn } from '@/lib/utils';
import { opencodeClient, type GitHubRepo } from '@/lib/opencode/client';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { toast } from 'sonner';
import { normalizePath, joinPath } from '@/lib/paths';

interface RepoPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RepoPickerDialog({ open, onOpenChange }: RepoPickerDialogProps) {
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [cloning, setCloning] = useState<string | null>(null);

  const { addProject, projects } = useProjectsStore();
  const homeDirectory = useDirectoryStore((s) => s.homeDirectory);

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    opencodeClient
      .listGitHubRepos()
      .then((result) => {
        setRepos(result);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to fetch repositories';
        setError(message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open]);

  const filteredRepos = useMemo(() => {
    if (!searchQuery.trim()) return repos;
    const query = searchQuery.toLowerCase();
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(query) ||
        (r.description && r.description.toLowerCase().includes(query))
    );
  }, [repos, searchQuery]);

  const existingRepoNames = useMemo(() => {
    return new Set(projects.map((p) => `${p.owner}/${p.repo}`));
  }, [projects]);

  const getCloneTargetDir = (repo: GitHubRepo): string => {
    const home = homeDirectory || '';
    return joinPath(joinPath(joinPath(home, 'openchamber'), repo.name), 'main');
  };

  const handleSelectRepo = async (repo: GitHubRepo) => {
    if (cloning) return;

    const [owner, repoName] = repo.fullName.split('/');
    if (!owner || !repoName) {
      toast.error('Invalid repository name');
      return;
    }

    if (existingRepoNames.has(repo.fullName)) {
      toast.info('Repository already added');
      onOpenChange(false);
      return;
    }

    setCloning(repo.fullName);

    try {
      const targetDir = getCloneTargetDir(repo);
      const result = await opencodeClient.cloneGitHubRepo(repo.cloneUrl, targetDir);

      if (result.success) {
        const path = normalizePath(result.path) || targetDir;
        const added = addProject(path, { owner, repo: repoName });
        if (added) {
          toast.success(`Added ${repo.fullName}`);
          onOpenChange(false);
        } else {
          toast.error('Failed to add repository to projects');
        }
      } else {
        toast.error('Failed to clone repository');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Clone failed';
      toast.error('Failed to clone repository', { description: message });
    } finally {
      setCloning(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Repository</DialogTitle>
          <DialogDescription>
            Select a GitHub repository to add to your workspace
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search repositories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <RiLoader4Line className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading repositories...</span>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <RiAlertLine className="h-8 w-8 text-muted-foreground/60 mb-2" />
              <p className="text-sm text-muted-foreground mb-1">Could not load repositories</p>
              <p className="text-xs text-muted-foreground/70">{error}</p>
            </div>
          )}

          {!loading && !error && filteredRepos.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <RiGitRepositoryLine className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">
                {searchQuery ? 'No matching repositories' : 'No repositories found'}
              </p>
            </div>
          )}

          {!loading && !error && filteredRepos.length > 0 && (
            <div className="space-y-0.5 py-1">
              {filteredRepos.map((repo) => {
                const isAdded = existingRepoNames.has(repo.fullName);
                const isCloning = cloning === repo.fullName;

                return (
                  <button
                    key={repo.fullName}
                    type="button"
                    onClick={() => handleSelectRepo(repo)}
                    disabled={isCloning || (cloning !== null && cloning !== repo.fullName)}
                    className={cn(
                      'w-full flex items-start gap-3 px-3 py-2.5 rounded-md text-left transition-colors',
                      isAdded
                        ? 'opacity-50 cursor-default'
                        : 'hover:bg-muted/50 cursor-pointer',
                      isCloning && 'bg-muted/30'
                    )}
                  >
                    <div className="mt-0.5 shrink-0">
                      {isCloning ? (
                        <RiLoader4Line className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        <RiGitRepositoryLine className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {repo.fullName}
                        </span>
                        {repo.isPrivate ? (
                          <RiLockLine className="h-3 w-3 text-muted-foreground shrink-0" />
                        ) : (
                          <RiGlobalLine className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                        {isAdded && (
                          <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                            Added
                          </span>
                        )}
                      </div>
                      {repo.description && (
                        <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                          {repo.description}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
