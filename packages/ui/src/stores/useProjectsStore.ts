import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { opencodeClient } from '@/lib/opencode/client';
import type { ProjectEntry, WorktreeDefaults } from '@/lib/api/types';
import { getSettingsValue, setSettingsValue, removeSettingsValue } from '@/lib/settingsStorage';
import { getInstantCache, setInstantCache, INSTANT_CACHE_KEYS } from '@/lib/instantCache';
import { useDirectoryStore } from './useDirectoryStore';
import { streamDebugEnabled } from '@/stores/utils/streamDebug';
import { checkIsGitRepository, getRemoteUrl } from '@/lib/gitApi';
import { parseGitHubRemoteUrl } from '@/lib/github-repos/utils';
import { normalizePath, joinPath } from '@/lib/paths';

const OPENCHAMBER_DIR = 'openchamber';
const BARE_DIR = '.bare';
const WORKTREE_DEFAULTS_PREFIX = 'worktreeDefaults:';

/**
 * Get the home directory from the directory store or fallback sources.
 */
const getHomeDirectory = (): string => {
  try {
    const storeHome = useDirectoryStore.getState().homeDirectory;
    if (storeHome && storeHome !== '/') {
      return normalizePath(storeHome);
    }
  } catch {
    // Store might not be initialized yet
  }

  const stored = getSettingsValue('homeDirectory');
  if (stored && stored !== '/') {
    return normalizePath(stored);
  }

  return '';
};

/**
 * Get the openchamber root directory: ~/openchamber
 */
const getOpenchamberRoot = (): string => {
  const home = getHomeDirectory();
  if (!home) return '';
  return joinPath(home, OPENCHAMBER_DIR);
};

/**
 * Build a project ID from owner/repo.
 */
const buildProjectId = (owner: string, repo: string): string => `${owner}/${repo}`;

/**
 * Read worktree defaults from localStorage for a project.
 */
const readWorktreeDefaults = (projectId: string): WorktreeDefaults | undefined => {
  try {
    const raw = getSettingsValue(`${WORKTREE_DEFAULTS_PREFIX}${projectId}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const defaults: WorktreeDefaults = {};
    if (typeof parsed.branchPrefix === 'string') defaults.branchPrefix = parsed.branchPrefix;
    if (typeof parsed.baseBranch === 'string') defaults.baseBranch = parsed.baseBranch;
    if (typeof parsed.autoCreateWorktree === 'boolean') defaults.autoCreateWorktree = parsed.autoCreateWorktree;
    return Object.keys(defaults).length > 0 ? defaults : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Write worktree defaults to localStorage for a project.
 */
const writeWorktreeDefaults = (projectId: string, defaults: WorktreeDefaults | undefined) => {
  try {
    if (!defaults || Object.keys(defaults).length === 0) {
      removeSettingsValue(`${WORKTREE_DEFAULTS_PREFIX}${projectId}`);
    } else {
      setSettingsValue(`${WORKTREE_DEFAULTS_PREFIX}${projectId}`, JSON.stringify(defaults));
    }
  } catch {
    // ignored
  }
};

/**
 * Cached project entry shape (minimal fields for fast loading).
 */
interface CachedProject {
  id: string;
  path: string;
  owner: string;
  repo: string;
  label?: string;
}

/**
 * Read cached projects from localStorage for INSTANT loading.
 * This is synchronous and available immediately at module load time.
 */
const readCachedProjects = (): ProjectEntry[] => {
  const cached = getInstantCache<CachedProject[]>(INSTANT_CACHE_KEYS.PROJECTS);
  if (!cached || !Array.isArray(cached)) return [];

  return cached.map((entry) => {
    if (!entry.id || !entry.path) return null;
    return {
      id: entry.id,
      path: entry.path,
      owner: entry.owner || '',
      repo: entry.repo || '',
      label: entry.label,
      // Note: worktreeDefaults loaded separately via settingsStorage (async is OK for this)
    } as ProjectEntry;
  }).filter((p): p is ProjectEntry => p !== null);
};

/**
 * Write projects to localStorage for instant loading on next startup.
 */
const writeCachedProjects = (projects: ProjectEntry[]) => {
  // Only cache essential fields for fast loading
  const toCache: CachedProject[] = projects.map(({ id, path, owner, repo, label }) => ({
    id,
    path,
    owner,
    repo,
    label,
  }));
  setInstantCache(INSTANT_CACHE_KEYS.PROJECTS, toCache);
};

interface ProjectsStore {
  projects: ProjectEntry[];
  activeProjectId: string | null;
  isDiscovering: boolean;

  discoverProjects: () => Promise<void>;
  addProject: (path: string, options: { owner: string; repo: string }) => ProjectEntry | null;
  removeProject: (id: string) => void;
  setActiveProject: (id: string) => void;
  setActiveProjectIdOnly: (id: string) => void;
  getActiveProject: () => ProjectEntry | null;
  updateWorktreeDefaults: (projectId: string, defaults: Partial<WorktreeDefaults>) => void;
}

/**
 * Read the persisted active project ID from localStorage (instant).
 */
const readActiveProjectId = (): string | null => {
  const cached = getInstantCache<string>(INSTANT_CACHE_KEYS.ACTIVE_PROJECT_ID);
  if (typeof cached === 'string' && cached.trim().length > 0) {
    return cached.trim();
  }
  return null;
};

/**
 * Persist active project ID to localStorage for instant loading.
 */
const persistActiveProjectId = (id: string | null) => {
  if (id) {
    setInstantCache(INSTANT_CACHE_KEYS.ACTIVE_PROJECT_ID, id);
  } else {
    // Clear by setting empty
    setInstantCache(INSTANT_CACHE_KEYS.ACTIVE_PROJECT_ID, '');
  }
};

/**
 * For VS Code runtime, derive a single project from the workspace folder.
 */
const getVSCodeWorkspaceProject = (): { projects: ProjectEntry[]; activeProjectId: string | null } | null => {
  if (typeof window === 'undefined') return null;

  const runtimeApis = (window as unknown as { __OPENCHAMBER_RUNTIME_APIS__?: { runtime?: { isVSCode?: boolean } } })
    .__OPENCHAMBER_RUNTIME_APIS__;
  if (!runtimeApis?.runtime?.isVSCode) return null;

  const workspaceFolder = (window as unknown as { __VSCODE_CONFIG__?: { workspaceFolder?: unknown } }).__VSCODE_CONFIG__?.workspaceFolder;
  if (typeof workspaceFolder !== 'string' || workspaceFolder.trim().length === 0) return null;

  const normalizedPath = normalizePath(workspaceFolder.trim());
  if (!normalizedPath) return null;

  const id = `vscode:${normalizedPath}`;
  const segments = normalizedPath.split('/').filter(Boolean);
  const entry: ProjectEntry = {
    id,
    path: normalizedPath,
    label: segments[segments.length - 1] || 'Workspace',
    owner: '',
    repo: '',
  };

  return { projects: [entry], activeProjectId: id };
};

const vscodeWorkspace = getVSCodeWorkspaceProject();
const initialActiveProjectId = vscodeWorkspace?.activeProjectId ?? readActiveProjectId();
// Load cached projects for instant sidebar display
const cachedProjects = vscodeWorkspace ? [] : readCachedProjects();

export const useProjectsStore = create<ProjectsStore>()(
  devtools((set, get) => ({
    // Use cached projects for instant display, will be refreshed by discoverProjects
    projects: vscodeWorkspace?.projects ?? cachedProjects,
    activeProjectId: initialActiveProjectId,
    isDiscovering: false,

    /**
     * Scan ~/openchamber/ for repo directories with bare repo structure.
     * Structure: ~/openchamber/<repo-name>/.bare + worktrees
     * Derives owner/repo from git remote. Does NOT navigate — users must select a worktree.
     */
    discoverProjects: async () => {
      if (vscodeWorkspace) return;

      const openchamberRoot = getOpenchamberRoot();
      if (!openchamberRoot) {
        if (streamDebugEnabled()) {
          console.warn('[ProjectsStore] Cannot discover projects: no home directory');
        }
        return;
      }

      set({ isDiscovering: true });

      try {
        const entries = await opencodeClient.listLocalDirectory(openchamberRoot);
        const repoDirs = entries.filter((e) => e.isDirectory);

        const results = await Promise.allSettled(
          repoDirs.map(async (repoDir) => {
            const repoName = repoDir.name;
            const repoDirPath = joinPath(openchamberRoot, repoName);

            // Check if this is a valid bare repo setup
            const isGit = await checkIsGitRepository(repoDirPath).catch(() => false);
            if (!isGit) return null;

            const remoteUrl = await getRemoteUrl(repoDirPath, 'origin').catch(() => null);
            if (!remoteUrl) return null;

            const info = parseGitHubRemoteUrl(remoteUrl);
            if (!info) return null;

            const id = buildProjectId(info.owner, info.repo);
            const entry: ProjectEntry = {
              id,
              path: repoDirPath,
              owner: info.owner,
              repo: info.repo,
              label: `${info.owner}/${info.repo}`,
              worktreeDefaults: readWorktreeDefaults(id),
            };
            return entry;
          })
        );

        const discovered: ProjectEntry[] = [];
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value !== null) {
            discovered.push(result.value);
          }
        }

        if (streamDebugEnabled()) {
          console.log('[ProjectsStore] Discovered projects:', discovered.map((p) => p.id));
        }

        const current = get();
        let nextActiveId = current.activeProjectId;

        if (nextActiveId && !discovered.find((p) => p.id === nextActiveId)) {
          nextActiveId = discovered[0]?.id ?? null;
          persistActiveProjectId(nextActiveId);
        }

        if (!nextActiveId && discovered.length > 0) {
          nextActiveId = discovered[0].id;
          persistActiveProjectId(nextActiveId);
        }

        set({ projects: discovered, activeProjectId: nextActiveId, isDiscovering: false });
        // Cache projects for instant loading on next startup
        writeCachedProjects(discovered);
        // Navigation is handled by worktree selection in the sidebar, not here
      } catch (error) {
        if (streamDebugEnabled()) {
          console.error('[ProjectsStore] Failed to discover projects:', error);
        }
        set({ isDiscovering: false });
      }
    },

    /**
     * Add a project entry. Does NOT navigate to the main clone —
     * the user must create/select a worktree to start working.
     */
    addProject: (path: string, options: { owner: string; repo: string }) => {
      if (vscodeWorkspace) return null;

      const normalized = normalizePath(path.trim());
      if (!normalized) return null;

      const owner = options.owner.trim();
      const repo = options.repo.trim();
      if (!owner || !repo) return null;

      const id = buildProjectId(owner, repo);
      const existing = get().projects.find((p) => p.id === id);
      if (existing) {
        get().setActiveProjectIdOnly(existing.id);
        return existing;
      }

      const entry: ProjectEntry = {
        id,
        path: normalized,
        owner,
        repo,
        label: `${owner}/${repo}`,
      };

      const nextProjects = [...get().projects, entry];
      set({ projects: nextProjects, activeProjectId: id });
      persistActiveProjectId(id);

      if (streamDebugEnabled()) {
        console.info('[ProjectsStore] Added project', entry);
      }

      void get().discoverProjects();

      return entry;
    },

    /**
     * Remove a project from the list. Does NOT navigate.
     */
    removeProject: (id: string) => {
      if (vscodeWorkspace) return;

      const current = get();
      const nextProjects = current.projects.filter((p) => p.id !== id);
      let nextActiveId = current.activeProjectId;

      if (current.activeProjectId === id) {
        nextActiveId = nextProjects[0]?.id ?? null;
      }

      set({ projects: nextProjects, activeProjectId: nextActiveId });
      persistActiveProjectId(nextActiveId);
    },

    /**
     * Set the active project. Does NOT navigate to the main clone —
     * the user must select a worktree in the sidebar to navigate.
     */
    setActiveProject: (id: string) => {
      if (vscodeWorkspace) return;

      const { projects, activeProjectId } = get();
      if (activeProjectId === id) return;

      const target = projects.find((p) => p.id === id);
      if (!target) return;

      set({ activeProjectId: id });
      persistActiveProjectId(id);
    },

    setActiveProjectIdOnly: (id: string) => {
      if (vscodeWorkspace) return;

      const { projects, activeProjectId } = get();
      if (activeProjectId === id) return;

      const target = projects.find((p) => p.id === id);
      if (!target) return;

      set({ activeProjectId: id });
      persistActiveProjectId(id);
    },

    getActiveProject: () => {
      const { projects, activeProjectId } = get();
      if (!activeProjectId) return null;
      return projects.find((p) => p.id === activeProjectId) ?? null;
    },

    updateWorktreeDefaults: (projectId: string, defaults: Partial<WorktreeDefaults>) => {
      if (vscodeWorkspace) return;

      const { projects } = get();
      const target = projects.find((p) => p.id === projectId);
      if (!target) return;

      const merged: WorktreeDefaults = { ...target.worktreeDefaults };
      if (defaults.branchPrefix !== undefined) {
        if (defaults.branchPrefix.trim()) {
          merged.branchPrefix = defaults.branchPrefix.trim();
        } else {
          delete merged.branchPrefix;
        }
      }
      if (defaults.baseBranch !== undefined) {
        if (defaults.baseBranch.trim()) {
          merged.baseBranch = defaults.baseBranch.trim();
        } else {
          delete merged.baseBranch;
        }
      }
      if (defaults.autoCreateWorktree !== undefined) {
        merged.autoCreateWorktree = defaults.autoCreateWorktree;
      }

      const finalDefaults = Object.keys(merged).length > 0 ? merged : undefined;
      writeWorktreeDefaults(projectId, finalDefaults);

      const nextProjects = projects.map((p) =>
        p.id === projectId ? { ...p, worktreeDefaults: finalDefaults } : p
      );
      set({ projects: nextProjects });
    },
  }), { name: 'projects-store' })
);

