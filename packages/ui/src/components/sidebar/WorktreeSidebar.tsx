import React, { useCallback, useMemo, useState } from 'react';
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowLeftLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiFolderOpenLine,
  RiGitBranchLine,
  RiGitPullRequestLine,
  RiGitRepositoryLine,
  RiMore2Line,
  RiSearchLine,
  RiSideBarLine,
} from '@remixicon/react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { GridLoader } from '@/components/ui/grid-loader';
import { cn, formatDirectoryName, getModifierLabel } from '@/lib/utils';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useChatStore } from '@/stores/useChatStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useUIStore } from '@/stores/useUIStore';
import { sessionEvents } from '@/lib/sessionEvents';
import { BranchPickerDialog } from '@/components/session/BranchPickerDialog';
import type { WorktreeMetadata } from '@/types/worktree';
import { SIDEBAR_SECTIONS, type SidebarSection } from '@/constants/sidebar';
import { isVSCodeRuntime } from '@/lib/desktop';
import { useAutoReviewStore } from '@/stores/useAutoReviewStore';

const normalizePath = (value?: string | null): string | null => {
  if (!value) return null;
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.length === 0 ? '/' : normalized;
};

const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
};

interface WorktreeStats {
  additions: number;
  deletions: number;
  lastUpdated: number | null;
  sessionTitle: string | null;
}

interface WorktreeItemProps {
  worktree: WorktreeMetadata;
  isActive: boolean;
  isMain: boolean;
  stats: WorktreeStats;
  onSelect: () => void;
  onClose?: () => void;
  onOpenInFinder?: () => void;
  isAutoReviewEnabled?: boolean;
}

const WorktreeItem: React.FC<WorktreeItemProps> = ({
  worktree,
  isActive,
  isMain,
  stats,
  onSelect,
  onClose,
  onOpenInFinder,
  isAutoReviewEnabled,
}) => {
  const branchLabel = isMain ? 'main' : (worktree.branch || 'worktree');
  const primaryLabel = stats.sessionTitle || (isMain ? 'main' : (worktree.label || worktree.branch || 'worktree'));
  const hasChanges = stats.additions > 0 || stats.deletions > 0;
  const showActions = onOpenInFinder || (!isMain && onClose);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Show streaming indicator only for the active worktree
  const activityPhase = useChatStore((s) => s.activityPhase);
  const isStreaming = isActive && (activityPhase === 'busy' || activityPhase === 'cooldown');
  
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!showActions) return;
    e.preventDefault();
    setDropdownOpen(true);
  }, [showActions]);

  return (
    <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
      <div
        className={cn(
          'group flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left',
          'transition-colors cursor-pointer',
          isActive
            ? 'bg-primary/10'
            : 'hover:bg-muted/50'
        )}
        onClick={onSelect}
        onContextMenu={handleContextMenu}
      >
        <div className="flex items-center gap-2">
          <RiGitBranchLine className={cn(
            'h-4 w-4 shrink-0',
            isActive ? 'text-primary' : 'text-muted-foreground'
          )} />
          <div className="flex-1 min-w-0">
            <span className={cn(
              'block truncate text-sm',
              isActive ? 'text-primary font-medium' : 'text-foreground'
            )}>
              {primaryLabel}
            </span>
            {stats.sessionTitle && !isMain && (
              <span className="block truncate text-xs text-muted-foreground">
                {branchLabel}
              </span>
            )}
          </div>
          {isStreaming && (
            <GridLoader size="xs" className="text-primary shrink-0" />
          )}
          {isAutoReviewEnabled && !isStreaming && (
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <span className="h-2 w-2 rounded-full bg-cyan-500 shrink-0 animate-pulse" />
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">Auto-review enabled</TooltipContent>
            </Tooltip>
          )}
          {worktree.status?.isDirty && !isStreaming && !isAutoReviewEnabled && (
            <span className="h-2 w-2 rounded-full bg-warning shrink-0" title="Uncommitted changes" />
          )}
          {showActions && (
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted/50 transition-all"
              >
                <RiMore2Line className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
          )}
        </div>
        
        {hasChanges && (
          <div className="flex items-center gap-2 pl-6 text-xs text-muted-foreground">
            <span className="flex items-center gap-0.5">
              <span className="text-[color:var(--status-success)]">+{stats.additions}</span>
              <span>/</span>
              <span className="text-destructive">-{stats.deletions}</span>
            </span>
            {stats.lastUpdated && (
              <span className="text-muted-foreground/70">
                {formatRelativeTime(stats.lastUpdated)}
              </span>
            )}
          </div>
        )}
      </div>
      {showActions && (
        <DropdownMenuContent align="end" className="min-w-[120px]">
          {onOpenInFinder && (
            <DropdownMenuItem onClick={onOpenInFinder}>
              <RiFolderOpenLine className="mr-1.5 h-4 w-4" />
              Open in Finder
            </DropdownMenuItem>
          )}
          {onClose && (
            <DropdownMenuItem
              onClick={onClose}
              className="text-destructive focus:text-destructive"
            >
              <RiCloseLine className="mr-1.5 h-4 w-4" />
              Close Worktree
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
};

interface ProjectSectionProps {
  project: {
    id: string;
    path: string;
    label?: string;
    normalizedPath: string;
    owner: string;
    repo: string;
  };
  isActive: boolean;
  worktrees: WorktreeMetadata[];
  activeWorktreePath: string | null;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSelectWorktree: (path: string) => void;
  onClose: () => void;
  onCloseWorktree?: (worktreePath: string) => void;
  onOpenInFinder?: (worktreePath: string) => void;
  onOpenBranchPicker?: () => void;
  onOpenGitHubBoard?: () => void;
  getWorktreeStats: (worktreePath: string) => WorktreeStats;
  autoReviewDirectory: string | null;
}

const ProjectSection: React.FC<ProjectSectionProps> = ({
  project,
  isActive,
  worktrees,
  activeWorktreePath,
  isCollapsed,
  onToggleCollapse,
  onSelectWorktree,
  onClose,
  onCloseWorktree,
  onOpenInFinder,
  onOpenBranchPicker,
  onOpenGitHubBoard,
  getWorktreeStats,
  autoReviewDirectory,
}) => {
  const projectLabel = project.label || formatDirectoryName(project.path);
  const normalizedProjectPath = project.normalizedPath;
  
  const actualWorktrees = useMemo(() => {
    return worktrees.filter(w => normalizePath(w.path) !== normalizedProjectPath);
  }, [worktrees, normalizedProjectPath]);

  const projectStats = useMemo(() => {
    let totalAdditions = 0;
    let totalDeletions = 0;
    let lastUpdated: number | null = null;

    actualWorktrees.forEach(wt => {
      const stats = getWorktreeStats(wt.path);
      totalAdditions += stats.additions;
      totalDeletions += stats.deletions;
      if (stats.lastUpdated && (!lastUpdated || stats.lastUpdated > lastUpdated)) {
        lastUpdated = stats.lastUpdated;
      }
    });

    return { totalAdditions, totalDeletions, lastUpdated };
  }, [actualWorktrees, getWorktreeStats]);

  return (
    <div className="mb-2">
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md px-1 py-1',
          'hover:bg-muted/30 transition-colors'
        )}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex flex-1 items-center gap-1.5 text-left min-w-0"
        >
          {isCollapsed ? (
            <RiArrowRightSLine className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <RiArrowDownSLine className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className={cn(
            'flex-1 truncate text-base font-medium',
            isActive ? 'text-foreground' : 'text-muted-foreground'
          )}>
            {projectLabel}
          </span>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted/50 transition-all"
              onClick={(e) => e.stopPropagation()}
            >
              <RiMore2Line className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuItem
              onClick={onClose}
              className="text-destructive focus:text-destructive"
            >
              <RiCloseLine className="mr-1.5 h-4 w-4" />
              Remove Repository
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {onOpenGitHubBoard && (
          <Tooltip delayDuration={700}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenGitHubBoard();
                }}
                className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted/50 transition-all"
                aria-label="Pull Requests"
              >
                <RiGitPullRequestLine className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Pull Requests</TooltipContent>
          </Tooltip>
        )}

        {onOpenBranchPicker && (
          <Tooltip delayDuration={700}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenBranchPicker();
                }}
                className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted/50 transition-all"
                aria-label="Browse branches"
              >
                <RiGitRepositoryLine className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Browse branches</TooltipContent>
          </Tooltip>
        )}
      </div>

      {isCollapsed && (projectStats.totalAdditions > 0 || projectStats.totalDeletions > 0) && (
        <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground ml-5">
          <span className="flex items-center gap-0.5">
            <span className="text-[color:var(--status-success)]">+{projectStats.totalAdditions}</span>
            <span>/</span>
            <span className="text-destructive">-{projectStats.totalDeletions}</span>
          </span>
          {projectStats.lastUpdated && (
            <span className="text-muted-foreground/70">
              {formatRelativeTime(projectStats.lastUpdated)}
            </span>
          )}
        </div>
      )}

      {!isCollapsed && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border/50 pl-2">
          {actualWorktrees.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground/70 italic">
              No worktrees yet
            </div>
          ) : (
            actualWorktrees.map((worktree) => {
              const worktreePath = normalizePath(worktree.path);
              const isWorktreeActive = worktreePath === activeWorktreePath;
              const stats = getWorktreeStats(worktree.path);
              const isAutoReviewEnabled = autoReviewDirectory !== null && worktreePath === autoReviewDirectory;
              
              return (
                <WorktreeItem
                  key={worktree.path}
                  worktree={worktree}
                  isActive={isWorktreeActive}
                  isMain={false}
                  stats={stats}
                  onSelect={() => onSelectWorktree(worktree.path)}
                  onClose={onCloseWorktree ? () => onCloseWorktree(worktree.path) : undefined}
                  onOpenInFinder={onOpenInFinder ? () => onOpenInFinder(worktree.path) : undefined}
                  isAutoReviewEnabled={isAutoReviewEnabled}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

interface WorktreeSidebarProps {
  mobileVariant?: boolean;
}

export const WorktreeSidebar: React.FC<WorktreeSidebarProps> = () => {
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const removeProject = useProjectsStore((s) => s.removeProject);
  const setActiveProject = useProjectsStore((s) => s.setActiveProject);
  
  const availableWorktreesByProject = useChatStore((s) => s.availableWorktreesByProject);
  const allSessions = useChatStore((s) => s.allSessions);
  
  const currentDirectory = useDirectoryStore((s) => s.currentDirectory);
  const setDirectory = useDirectoryStore((s) => s.setDirectory);
  
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const isSettingsOpen = useUIStore((s) => s.isSettingsDialogOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsDialogOpen);
  const activeSettingsTab = useUIStore((s) => s.activeSettingsTab);
  const setActiveSettingsTab = useUIStore((s) => s.setActiveSettingsTab);

  const autoReviewDirectory = useAutoReviewStore((s) => s.activeDirectory);
  const normalizedAutoReviewDirectory = useMemo(() => normalizePath(autoReviewDirectory), [autoReviewDirectory]);

  const isVSCode = useMemo(() => isVSCodeRuntime(), []);
  
  const settingsSections = useMemo(() => {
    let sections = SIDEBAR_SECTIONS.filter(s => s.id !== 'sessions');
    if (isVSCode) {
      sections = sections.filter(s => s.id !== 'git-identities');
    }
    const openChamberSection = sections.find(s => s.id === 'settings');
    const otherSections = sections.filter(s => s.id !== 'settings');
    return openChamberSection ? [openChamberSection, ...otherSections] : sections;
  }, [isVSCode]);

  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);

  const [isDesktopRuntime] = useState(() => {
    if (typeof window === 'undefined') return false;
    return typeof window.opencodeDesktop !== 'undefined';
  });

  const activeWorktreePath = useMemo(() => {
    return normalizePath(currentDirectory);
  }, [currentDirectory]);

  const getWorktreeStats = useCallback((worktreePath: string): WorktreeStats => {
    const normalizedPath = normalizePath(worktreePath);
    if (!normalizedPath) {
      return { additions: 0, deletions: 0, lastUpdated: null, sessionTitle: null };
    }

    const session = allSessions.find((s) => {
      const dir = ((s as { directory?: string | null }).directory ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
      return dir === normalizedPath;
    });

    if (!session) {
      return { additions: 0, deletions: 0, lastUpdated: null, sessionTitle: null };
    }

    return {
      additions: (session as any).summary?.additions ?? 0,
      deletions: (session as any).summary?.deletions ?? 0,
      lastUpdated: session.time?.updated ?? session.time?.created ?? null,
      sessionTitle: session.title || null,
    };
  }, [allSessions]);

  const toggleProject = useCallback((projectId: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  const handleSelectWorktree = useCallback((projectId: string, worktreePath: string) => {
    if (projectId !== activeProjectId) {
      setActiveProject(projectId);
    }
    setDirectory(worktreePath, { showOverlay: false });
  }, [activeProjectId, setActiveProject, setDirectory]);

  const handleCloseProject = useCallback((projectId: string) => {
    removeProject(projectId);
    toast.success('Project closed');
  }, [removeProject]);

  const handleAddRepository = useCallback(() => {
    sessionEvents.requestDirectoryDialog();
  }, []);

  const handleCloseWorktree = useCallback((worktreePath: string) => {
    const normalizedPath = normalizePath(worktreePath);
    if (!normalizedPath) return;

    // Find the worktree metadata from availableWorktreesByProject
    let worktreeMetadata: WorktreeMetadata | null = null;
    for (const [, worktrees] of availableWorktreesByProject.entries()) {
      const found = worktrees.find(w => normalizePath(w.path) === normalizedPath);
      if (found) {
        worktreeMetadata = found;
        break;
      }
    }

    if (!worktreeMetadata) {
      toast.error('Worktree not found');
      return;
    }

    // Find the session linked to this worktree (one session per worktree)
    const linkedSession = allSessions.find(session => {
      const sessionDir = normalizePath((session as { directory?: string | null }).directory ?? null);
      return sessionDir === normalizedPath;
    });

    sessionEvents.requestDelete({
      sessions: linkedSession ? [linkedSession] : [],
      mode: 'worktree',
      worktree: worktreeMetadata,
    });
  }, [availableWorktreesByProject, allSessions]);

  const handleOpenInFinder = useCallback(async (worktreePath: string) => {
    const normalizedPath = normalizePath(worktreePath);
    if (!normalizedPath) return;

    if (isDesktopRuntime && window.opencodeDesktop?.openExternal) {
      const result = await window.opencodeDesktop.openExternal(`file://${normalizedPath}`);
      if (!result.success) {
        toast.error('Failed to open folder');
      }
    } else {
      try {
        const response = await fetch('/api/fs/reveal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: normalizedPath }),
        });
        
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to open folder');
        }
      } catch (error) {
        toast.error('Failed to open folder', {
          description: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }, [isDesktopRuntime]);

  const handleOpenBranchPicker = useCallback(() => {
    setBranchPickerOpen(true);
  }, []);

  const openGitHubRepoDetail = useUIStore((state) => state.openGitHubRepoDetail);

  const handleOpenGitHubBoard = useCallback((projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    openGitHubRepoDetail(project.owner, project.repo, project.path);
  }, [openGitHubRepoDetail, projects]);

  const normalizedProjects = useMemo(() => {
    return projects.map((p) => ({
      ...p,
      normalizedPath: normalizePath(p.path),
    })).filter((p) => p.normalizedPath) as Array<{
      id: string;
      path: string;
      label?: string;
      normalizedPath: string;
      owner: string;
      repo: string;
    }>;
  }, [projects]);

  const handleSelectSettingsTab = useCallback((tab: SidebarSection) => {
    setActiveSettingsTab(tab);
  }, [setActiveSettingsTab]);

  const renderSettingsView = () => (
    <div className="flex flex-col h-full">
      <div className="flex h-12 min-h-12 items-center justify-between px-3 border-b border-border/50">
        <button
          type="button"
          onClick={() => setSettingsOpen(false)}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <RiArrowLeftLine className="h-4 w-4" />
          <span>Settings</span>
        </button>
      </div>

      <ScrollableOverlay className="flex-1 overflow-y-auto p-2">
        {settingsSections.map(({ id, label, icon: Icon }) => {
          const isActive = activeSettingsTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleSelectSettingsTab(id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">{label}</span>
            </button>
          );
        })}
      </ScrollableOverlay>
    </div>
  );

  const renderSidebarHeader = () => (
    <div className="flex h-12 min-h-12 items-center justify-between px-3 border-b border-border/50">
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleSidebar}
              className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50"
            >
              <RiSideBarLine className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Close Sidebar</TooltipContent>
        </Tooltip>
        <span className="text-sm font-medium text-muted-foreground">Repositories</span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleAddRepository}
            className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50"
          >
            <RiAddLine className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Add Repository</TooltipContent>
      </Tooltip>
    </div>
  );

  if (isSettingsOpen) {
    return renderSettingsView();
  }

  if (normalizedProjects.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {renderSidebarHeader()}
        <div className="px-2 pt-2">
          <button
            type="button"
            onClick={toggleCommandPalette}
            className="flex w-full items-center gap-2 px-2.5 py-2 rounded border border-muted-foreground/25 text-muted-foreground hover:text-foreground hover:bg-muted/40 hover:border-muted-foreground/40 transition-all"
          >
            <RiSearchLine className="h-4 w-4" />
            <span className="flex-1 text-left text-sm">Search...</span>
            <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border/50 bg-muted/30 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              {getModifierLabel()}K
            </kbd>
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
          <RiGitRepositoryLine className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium text-muted-foreground mb-1">No repositories yet</p>
          <p className="text-xs text-muted-foreground/70 mb-4">Add a repository to get started</p>
          <button
            type="button"
            onClick={handleAddRepository}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
          >
            <RiAddLine className="h-4 w-4" />
            Add Repository
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {renderSidebarHeader()}

      <div className="px-2 pt-2">
        <button
          type="button"
          onClick={toggleCommandPalette}
          className="flex w-full items-center gap-2 px-2.5 py-2 rounded border border-muted-foreground/25 text-muted-foreground hover:text-foreground hover:bg-muted/40 hover:border-muted-foreground/40 transition-all"
        >
          <RiSearchLine className="h-4 w-4" />
          <span className="flex-1 text-left text-sm">Search...</span>
          <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border/50 bg-muted/30 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            {getModifierLabel()}K
          </kbd>
        </button>
      </div>

      <ScrollableOverlay className="flex-1 overflow-y-auto p-2">
        {normalizedProjects.map((project) => {
          const worktrees = availableWorktreesByProject.get(project.normalizedPath) ?? [];
          const isActive = project.id === activeProjectId;
          const isCollapsed = collapsedProjects.has(project.id);

          return (
            <ProjectSection
              key={project.id}
              project={project}
              isActive={isActive}
              worktrees={worktrees}
              activeWorktreePath={activeWorktreePath}
              isCollapsed={isCollapsed}
              onToggleCollapse={() => toggleProject(project.id)}
              onSelectWorktree={(path) => handleSelectWorktree(project.id, path)}
              onClose={() => handleCloseProject(project.id)}
              onCloseWorktree={handleCloseWorktree}
              onOpenInFinder={handleOpenInFinder}
              onOpenBranchPicker={handleOpenBranchPicker}
              onOpenGitHubBoard={() => handleOpenGitHubBoard(project.id)}
              getWorktreeStats={getWorktreeStats}
              autoReviewDirectory={normalizedAutoReviewDirectory}
            />
          );
        })}
      </ScrollableOverlay>

      <BranchPickerDialog
        open={branchPickerOpen}
        onOpenChange={setBranchPickerOpen}
        projects={normalizedProjects}
        activeProjectId={activeProjectId}
      />
    </div>
  );
};
