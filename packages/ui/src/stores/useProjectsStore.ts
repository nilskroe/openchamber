import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { opencodeClient } from '@/lib/opencode/client';
import type { ProjectEntry, WorktreeDefaults } from '@/lib/api/types';
import { getSafeStorage } from './utils/safeStorage';
import { useDirectoryStore } from './useDirectoryStore';
import { streamDebugEnabled } from '@/stores/utils/streamDebug';
import { checkIsGitRepository, getRemoteUrl } from '@/lib/gitApi';
import { parseGitHubRemoteUrl } from '@/lib/github-repos/utils';
import { normalizePath, joinPath } from '@/lib/paths';

const OPENCHAMBER_DIR = 'openchamber';
const MAIN_DIR = 'main';
const ACTIVE_PROJECT_KEY = 'activeProjectId';
const WORKTREE_DEFAULTS_PREFIX = 'worktreeDefaults:';

const safeStorage = getSafeStorage();

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

  if (typeof window !== 'undefined' && window.localStorage) {
    const stored = window.localStorage.getItem('homeDirectory');
    if (stored && stored !== '/') {
      return normalizePath(stored);
    }
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
    const raw = safeStorage.getItem(`${WORKTREE_DEFAULTS_PREFIX}${projectId}`);
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
      safeStorage.removeItem(`${WORKTREE_DEFAULTS_PREFIX}${projectId}`);
    } else {
      safeStorage.setItem(`${WORKTREE_DEFAULTS_PREFIX}${projectId}`, JSON.stringify(defaults));
    }
  } catch {
    // ignored
  }
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
 * Read the persisted active project ID from localStorage.
 */
const readActiveProjectId = (): string | null => {
  try {
    const raw = safeStorage.getItem(ACTIVE_PROJECT_KEY);
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim();
    }
  } catch {
    // ignored
  }
  return null;
};

const persistActiveProjectId = (id: string | null) => {
  try {
    if (id) {
      safeStorage.setItem(ACTIVE_PROJECT_KEY, id);
    } else {
      safeStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
  } catch {
    // ignored
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

export const useProjectsStore = create<ProjectsStore>()(
  devtools((set, get) => ({
    projects: vscodeWorkspace?.projects ?? [],
    activeProjectId: initialActiveProjectId,
    isDiscovering: false,

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
        // List repo directories in ~/openchamber/
        const entries = await opencodeClient.listLocalDirectory(openchamberRoot);
        const repoDirs = entries.filter((e) => e.isDirectory);

        const discovered: ProjectEntry[] = [];

        for (const repoDir of repoDirs) {
          const repoName = repoDir.name;
          const repoDirPath = joinPath(openchamberRoot, repoName);
          const mainPath = normalizePath(joinPath(repoDirPath, MAIN_DIR));

          // Check if <repo>/main/ exists and is a git repo
          const isGit = await checkIsGitRepository(mainPath).catch(() => false);
          if (!isGit) continue;

          // Derive owner/repo from git remote
          const remoteUrl = await getRemoteUrl(mainPath, 'origin').catch(() => null);
          if (!remoteUrl) continue;

          const info = parseGitHubRemoteUrl(remoteUrl);
          if (!info) continue;

          const id = buildProjectId(info.owner, info.repo);

          discovered.push({
            id,
            path: mainPath,
            owner: info.owner,
            repo: info.repo,
            label: `${info.owner}/${info.repo}`,
            worktreeDefaults: readWorktreeDefaults(id),
          });
        }

        if (streamDebugEnabled()) {
          console.log('[ProjectsStore] Discovered projects:', discovered.map((p) => p.id));
        }

        const current = get();
        let nextActiveId = current.activeProjectId;

        // If the active project is no longer present, select the first one
        if (nextActiveId && !discovered.find((p) => p.id === nextActiveId)) {
          nextActiveId = discovered[0]?.id ?? null;
          persistActiveProjectId(nextActiveId);
        }

        // If no active project but projects exist, select the first
        if (!nextActiveId && discovered.length > 0) {
          nextActiveId = discovered[0].id;
          persistActiveProjectId(nextActiveId);
        }

        set({ projects: discovered, activeProjectId: nextActiveId, isDiscovering: false });

        // Switch the opencode client directory to the active project
        if (nextActiveId) {
          const activeProject = discovered.find((p) => p.id === nextActiveId);
          if (activeProject) {
            opencodeClient.setDirectory(activeProject.path);
            useDirectoryStore.getState().setDirectory(activeProject.path, { showOverlay: false });
          }
        }
      } catch (error) {
        if (streamDebugEnabled()) {
          console.error('[ProjectsStore] Failed to discover projects:', error);
        }
        set({ isDiscovering: false });
      }
    },

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
        get().setActiveProject(existing.id);
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

      opencodeClient.setDirectory(entry.path);
      useDirectoryStore.getState().setDirectory(entry.path, { showOverlay: false });

      if (streamDebugEnabled()) {
        console.info('[ProjectsStore] Added project', entry);
      }

      return entry;
    },

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

/**
 * Validate that a directory is a GitHub repository and extract owner/repo.
 * Returns { owner, repo } on success, or throws an error with a user-friendly message.
 */
export async function validateGitHubProject(path: string): Promise<{ owner: string; repo: string }> {
  const isGitRepo = await checkIsGitRepository(path).catch(() => false);
  if (!isGitRepo) {
    throw new Error('This directory is not a Git repository.');
  }

  const remoteUrl = await getRemoteUrl(path, 'origin');
  if (!remoteUrl) {
    throw new Error('No remote "origin" found. Only GitHub repositories can be added.');
  }

  const info = parseGitHubRemoteUrl(remoteUrl);
  if (!info) {
    throw new Error('Remote is not a GitHub repository. Only GitHub repositories are supported.');
  }

  return { owner: info.owner, repo: info.repo };
}
