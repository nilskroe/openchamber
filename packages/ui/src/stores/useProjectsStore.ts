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
  addProject: (path: string, options: { label?: string; id?: string; owner: string; repo: string }) => ProjectEntry | null;
  removeProject: (id: string) => void;
  setActiveProject: (id: string) => void;
  setActiveProjectIdOnly: (id: string) => void;
  getActiveProject: () => ProjectEntry | null;
  updateWorktreeDefaults: (projectId: string, defaults: Partial<WorktreeDefaults>) => void;
  validateProjectPath: (path: string) => { ok: boolean; normalizedPath?: string; reason?: string };
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

      const reposRoot = getReposRoot();
      if (!reposRoot) {
        if (streamDebugEnabled()) {
          console.warn('[ProjectsStore] Cannot discover projects: no home directory');
        }
        return;
      }

      set({ isDiscovering: true });

      try {
        // List owner directories in ~/openchamber/repos/
        const ownerEntries = await opencodeClient.listLocalDirectory(reposRoot);
        const ownerDirs = ownerEntries.filter((e) => e.isDirectory);

        const discovered: ProjectEntry[] = [];

        for (const ownerDir of ownerDirs) {
          const owner = ownerDir.name;
          const ownerPath = joinPath(reposRoot, owner);

          // List repo directories in ~/openchamber/repos/<owner>/
          const repoEntries = await opencodeClient.listLocalDirectory(ownerPath);
          const repoDirs = repoEntries.filter((e) => e.isDirectory);

          for (const repoDir of repoDirs) {
            const repo = repoDir.name;
            const repoPath = normalizePath(joinPath(ownerPath, repo));
            const id = buildProjectId(owner, repo);

            discovered.push({
              id,
              path: repoPath,
              owner,
              repo,
              label: `${owner}/${repo}`,
              worktreeDefaults: readWorktreeDefaults(id),
            });
          }
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

    validateProjectPath: (path: string) => {
      if (typeof path !== 'string' || path.trim().length === 0) {
        return { ok: false, reason: 'Provide a directory path.' };
      }
      const normalized = normalizePath(path.trim());
      if (!normalized) {
        return { ok: false, reason: 'Directory path cannot be empty.' };
      }
      return { ok: true, normalizedPath: normalized };
    },

    addProject: (path: string, options: { label?: string; id?: string; owner: string; repo: string }) => {
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
        label: options.label?.trim() || `${owner}/${repo}`,
      };

      const nextProjects = [...get().projects, entry];
      set({ projects: nextProjects, activeProjectId: id });
      persistActiveProjectId(id);

      opencodeClient.setDirectory(entry.path);
      useDirectoryStore.getState().setDirectory(entry.path, { showOverlay: false });

      if (streamDebugEnabled()) {
        console.info('[ProjectsStore] Added project', entry);
      }

      // Re-discover from filesystem to stay in sync
      void get().discoverProjects();

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

      if (nextActiveId) {
        const nextActive = nextProjects.find((p) => p.id === nextActiveId);
        if (nextActive) {
          opencodeClient.setDirectory(nextActive.path);
          useDirectoryStore.getState().setDirectory(nextActive.path, { showOverlay: false });
        }
      } else {
        void useDirectoryStore.getState().goHome();
      }
    },

    setActiveProject: (id: string) => {
      if (vscodeWorkspace) return;

      const { projects, activeProjectId } = get();
      if (activeProjectId === id) return;

      const target = projects.find((p) => p.id === id);
      if (!target) return;

      set({ activeProjectId: id });
      persistActiveProjectId(id);

      opencodeClient.setDirectory(target.path);
      useDirectoryStore.getState().setDirectory(target.path, { showOverlay: false });
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
