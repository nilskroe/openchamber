import { addGitWorktree, deleteGitBranch, deleteRemoteBranch, getGitStatus, listGitWorktrees, removeGitWorktree, type GitAddWorktreePayload, type GitWorktreeInfo } from '@/lib/gitApi';
import { opencodeClient } from '@/lib/opencode/client';
import type { WorktreeMetadata } from '@/types/worktree';
import type { FilesAPI, RuntimeAPIs } from '@/lib/api/types';
import { getWorktreeSetupCommands, substituteCommandVariables } from '@/lib/openchamberConfig';
import { useDirectoryStore } from '@/stores/useDirectoryStore';

const OPENCHAMBER_ROOT = 'openchamber';
const WORKSPACES_DIR = 'workspaces';
const DEFAULT_BASE_URL = import.meta.env.VITE_OPENCODE_URL || '/api';

/**
 * Get the runtime Files API if available (Desktop/VSCode).
 */
function getRuntimeFilesAPI(): FilesAPI | null {
  if (typeof window === 'undefined') return null;
  const apis = (window as typeof window & { __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs }).__OPENCHAMBER_RUNTIME_APIS__;
  if (apis?.files) {
    return apis.files;
  }
  return null;
}

const normalize = (value: string): string => {
  if (!value) {
    return '';
  }
  const replaced = value.replace(/\\/g, '/');
  if (replaced === '/') {
    return '/';
  }
  return replaced.replace(/\/+$/, '');
};

const joinPath = (base: string, segment: string): string => {
  const normalizedBase = normalize(base);
  const sanitizedSegment = segment.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalizedBase || normalizedBase === '/') {
    return `/${sanitizedSegment}`;
  }
  return `${normalizedBase}/${sanitizedSegment}`;
};

const shortBranchLabel = (branch?: string): string => {
  if (!branch) {
    return '';
  }
  if (branch.startsWith('refs/heads/')) {
    return branch.substring('refs/heads/'.length);
  }
  if (branch.startsWith('heads/')) {
    return branch.substring('heads/'.length);
  }
  if (branch.startsWith('refs/')) {
    return branch.substring('refs/'.length);
  }
  return branch;
};

/**
 * Get the home directory from the directory store or fallback sources.
 */
const getHomeDirectory = (): string => {
  // Try to get from Zustand store
  try {
    const storeHome = useDirectoryStore.getState().homeDirectory;
    if (storeHome && storeHome !== '/') {
      return normalize(storeHome);
    }
  } catch {
    // Store might not be initialized yet
  }

  // Try localStorage fallback
  if (typeof window !== 'undefined' && window.localStorage) {
    const stored = window.localStorage.getItem('homeDirectory');
    if (stored && stored !== '/') {
      return normalize(stored);
    }
  }

  // Fallback to process.env.HOME for Node environments
  if (typeof process !== 'undefined' && process.env?.HOME) {
    return normalize(process.env.HOME);
  }

  return '';
};

/**
 * Extract repository name from a project path.
 * Takes the last segment of the path as the repo name.
 * e.g., "/Users/user/projects/my-repo" -> "my-repo"
 */
export const extractRepoName = (projectDirectory: string): string => {
  const normalized = normalize(projectDirectory);
  if (!normalized || normalized === '/') {
    return 'unnamed-repo';
  }
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || 'unnamed-repo';
};

/**
 * Get the global openchamber workspaces root.
 * Returns: ~/openchamber/workspaces
 */
export const getWorkspacesRoot = (): string => {
  const home = getHomeDirectory();
  if (!home) {
    throw new Error('Could not determine home directory for openchamber workspaces');
  }
  return joinPath(joinPath(home, OPENCHAMBER_ROOT), WORKSPACES_DIR);
};

/**
 * Get the workspace directory for a specific repository.
 * Returns: ~/openchamber/workspaces/<repo-name>
 */
export const getRepoWorkspaceDir = (projectDirectory: string): string => {
  const workspacesRoot = getWorkspacesRoot();
  const repoName = extractRepoName(projectDirectory);
  return joinPath(workspacesRoot, repoName);
};

const ensureDirectory = async (path: string) => {
  try {
    await opencodeClient.createDirectory(path);
  } catch (error) {

    if (error instanceof Error) {
      if (/exist/i.test(error.message)) {
        return;
      }
    }
    throw error;
  }
};

export interface CreateWorktreeOptions {
  projectDirectory: string;
  worktreeSlug: string;
  branch: string;
  createBranch?: boolean;
  startPoint?: string;
}

export interface RemoveWorktreeOptions {
  projectDirectory: string;
  path: string;
  force?: boolean;
}

export interface ArchiveWorktreeOptions {
  projectDirectory: string;
  path: string;
  branch: string;
  force?: boolean;
  deleteRemote?: boolean;
  remote?: string;
}

/**
 * Resolve the path where a worktree should be created.
 * New structure: ~/openchamber/workspaces/<repo-name>/<worktree-slug>
 */
export async function resolveWorktreePath(projectDirectory: string, worktreeSlug: string): Promise<string> {
  const repoWorkspaceDir = getRepoWorkspaceDir(projectDirectory);
  const workspacesRoot = getWorkspacesRoot();
  
  await ensureDirectory(workspacesRoot);
  await ensureDirectory(repoWorkspaceDir);
  
  return joinPath(repoWorkspaceDir, worktreeSlug);
}

export async function createWorktree(options: CreateWorktreeOptions): Promise<WorktreeMetadata> {
  const { projectDirectory, worktreeSlug, branch, createBranch, startPoint } = options;
  const normalizedProject = normalize(projectDirectory);
  const worktreePath = await resolveWorktreePath(normalizedProject, worktreeSlug);
  const repoWorkspaceDir = getRepoWorkspaceDir(normalizedProject);

  const payload: GitAddWorktreePayload = {
    path: worktreePath,
    branch,
    createBranch: Boolean(createBranch),
    startPoint: startPoint?.trim() || undefined,
  };

  await addGitWorktree(normalizedProject, payload);

  return {
    path: worktreePath,
    branch,
    label: shortBranchLabel(branch),
    projectDirectory: normalizedProject,
    relativePath: worktreePath.startsWith(`${repoWorkspaceDir}/`)
      ? worktreePath.slice(repoWorkspaceDir.length + 1)
      : worktreeSlug,
  };
}

export async function removeWorktree(options: RemoveWorktreeOptions): Promise<void> {
  const { projectDirectory, path, force } = options;
  const normalizedProject = normalize(projectDirectory);
  await removeGitWorktree(normalizedProject, { path, force });
}

export async function archiveWorktree(options: ArchiveWorktreeOptions): Promise<void> {
  const { projectDirectory, path, branch, force, deleteRemote, remote } = options;
  const normalizedProject = normalize(projectDirectory);
  const normalizedBranch = branch.startsWith('refs/heads/')
    ? branch.substring('refs/heads/'.length)
    : branch;

  await removeGitWorktree(normalizedProject, { path, force });
  if (normalizedBranch) {
    await deleteGitBranch(normalizedProject, { branch: normalizedBranch, force: true });
    if (deleteRemote) {
      try {
        await deleteRemoteBranch(normalizedProject, {
          branch: normalizedBranch,
          remote,
        });
      } catch (error) {
        console.warn('Failed to delete remote branch during worktree archive:', error);
      }
    }
  }
}

export async function listWorktrees(projectDirectory: string): Promise<GitWorktreeInfo[]> {
  const normalizedProject = normalize(projectDirectory);
  return listGitWorktrees(normalizedProject);
}

export async function getWorktreeStatus(worktreePath: string): Promise<WorktreeMetadata['status']> {
  const normalizedPath = normalize(worktreePath);
  const status = await getGitStatus(normalizedPath);
  return {
    isDirty: !status.isClean,
    ahead: status.ahead,
    behind: status.behind,
    upstream: status.tracking,
  };
}

export function mapWorktreeToMetadata(projectDirectory: string, info: GitWorktreeInfo): WorktreeMetadata {
  const normalizedProject = normalize(projectDirectory);
  const normalizedPath = normalize(info.worktree);
  const repoWorkspaceDir = getRepoWorkspaceDir(normalizedProject);
  
  let relativePath: string;
  if (normalizedPath.startsWith(`${repoWorkspaceDir}/`)) {
    relativePath = normalizedPath.slice(repoWorkspaceDir.length + 1);
  } else if (normalizedPath.startsWith(`${normalizedProject}/`)) {
    relativePath = normalizedPath.slice(normalizedProject.length + 1);
  } else {
    const segments = normalizedPath.split('/').filter(Boolean);
    relativePath = segments[segments.length - 1] || normalizedPath;
  }
  
  return {
    path: normalizedPath,
    branch: info.branch ?? '',
    label: shortBranchLabel(info.branch ?? ''),
    projectDirectory: normalizedProject,
    relativePath,
  };
}

export interface WorktreeSetupResult {
  success: boolean;
  results: Array<{
    command: string;
    success: boolean;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    error?: string;
  }>;
}

/**
 * Run worktree setup commands in the background.
 * This does not block - it returns a promise that resolves when all commands complete.
 * 
 * @param worktreePath - The path to the new worktree where commands will run
 * @param projectDirectory - The root project directory (for $ROOT_WORKTREE_PATH substitution)
 * @param commands - Optional commands to run. If not provided, reads from config.
 * @returns Promise resolving to setup results
 */
export async function runWorktreeSetupCommands(
  worktreePath: string,
  projectDirectory: string,
  commands?: string[]
): Promise<WorktreeSetupResult> {
  const commandsToRun = commands ?? await getWorktreeSetupCommands(projectDirectory);
  
  if (commandsToRun.length === 0) {
    return { success: true, results: [] };
  }

  // Substitute variables in commands
  const substitutedCommands = commandsToRun.map(cmd => 
    substituteCommandVariables(cmd, { rootWorktreePath: projectDirectory })
  );

  console.log('[worktreeService] Running setup commands:', { worktreePath, projectDirectory, commands: substitutedCommands });

  try {
    // Try runtime API first (Desktop/VSCode)
    const runtimeFiles = getRuntimeFilesAPI();
    if (runtimeFiles?.execCommands) {
      console.log('[worktreeService] Using runtime API for exec');
      try {
        // Don't use background mode - we want actual results for toast notifications
        // The bridge now uses async exec (not execSync) so it won't block other operations
        const result = await runtimeFiles.execCommands(substitutedCommands, worktreePath);
        console.log('[worktreeService] Runtime exec result:', result);
        return result as WorktreeSetupResult;
      } catch (error) {
        console.error('[worktreeService] Runtime exec error:', error);
        return {
          success: false,
          results: substitutedCommands.map(cmd => ({
            command: cmd,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          })),
        };
      }
    }

    // Fall back to web API
    console.log('[worktreeService] Using web API for exec');

    const startResponse = await fetch(`${DEFAULT_BASE_URL}/fs/exec`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // Use background job so we don't hold long-lived HTTP connections.
      body: JSON.stringify({
        commands: substitutedCommands,
        cwd: worktreePath,
        background: true,
      }),
    });

    const startPayload = await startResponse.json().catch(() => null);

    if (startResponse.status === 202 && startPayload && typeof startPayload.jobId === 'string') {
      const jobId = startPayload.jobId as string;
      const pollIntervalMs = 800;
      const timeoutMs = Math.max(5 * 60_000, substitutedCommands.length * 60_000);
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

        const pollResponse = await fetch(`${DEFAULT_BASE_URL}/fs/exec/${jobId}`, {
          method: 'GET',
        });

        const pollPayload = await pollResponse.json().catch(() => null);
        if (!pollResponse.ok) {
          return {
            success: false,
            results: substitutedCommands.map((cmd) => ({
              command: cmd,
              success: false,
              error: (pollPayload && pollPayload.error) || 'Failed to poll exec job',
            })),
          };
        }

        const status = pollPayload?.status;
        if (status === 'done') {
          const results = Array.isArray(pollPayload?.results) ? pollPayload.results : [];
          const success = pollPayload?.success === true;
          return { success, results } as WorktreeSetupResult;
        }
      }

      return {
        success: false,
        results: substitutedCommands.map((cmd) => ({
          command: cmd,
          success: false,
          error: 'Setup commands timed out',
        })),
      };
    }

    if (!startResponse.ok) {
      const error = (startPayload && startPayload.error) || 'Request failed';
      console.error('[worktreeService] Web exec failed:', startPayload);
      return {
        success: false,
        results: substitutedCommands.map((cmd) => ({
          command: cmd,
          success: false,
          error,
        })),
      };
    }

    // Back-compat: older servers may still return results synchronously.
    console.log('[worktreeService] Web exec result:', startPayload);
    return startPayload as WorktreeSetupResult;
  } catch (error) {
    console.error('[worktreeService] Exec exception:', error);
    return {
      success: false,
      results: substitutedCommands.map(cmd => ({
        command: cmd,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })),
    };
  }
}

/**
 * Check if worktree setup commands are configured for a project.
 */
export async function hasWorktreeSetupCommands(projectDirectory: string): Promise<boolean> {
  const commands = await getWorktreeSetupCommands(projectDirectory);
  return commands.length > 0;
}

const LEGACY_WORKTREE_ROOT = '.openchamber';

export interface MigrateWorktreesResult {
  success: boolean;
  migrated: Array<{
    oldPath: string;
    newPath: string;
    success: boolean;
    error?: string;
  }>;
  targetDirectory?: string;
  message?: string;
  error?: string;
}

export async function hasLegacyWorktrees(projectDirectory: string): Promise<boolean> {
  const normalizedProject = normalize(projectDirectory);
  try {
    const worktrees = await listWorktrees(normalizedProject);
    const legacyRoot = `${normalizedProject}/${LEGACY_WORKTREE_ROOT}/`;
    return worktrees.some(wt => {
      const wtPath = normalize(wt.worktree);
      return wtPath.startsWith(legacyRoot);
    });
  } catch {
    return false;
  }
}

export async function migrateWorktreesToGlobalLocation(
  projectDirectory: string
): Promise<MigrateWorktreesResult> {
  const normalizedProject = normalize(projectDirectory);
  
  try {
    const response = await fetch(`${DEFAULT_BASE_URL}/git/migrate-worktrees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDirectory: normalizedProject }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return {
        success: false,
        migrated: [],
        error: data.error || 'Migration request failed',
      };
    }

    return await response.json() as MigrateWorktreesResult;
  } catch (error) {
    return {
      success: false,
      migrated: [],
      error: error instanceof Error ? error.message : 'Migration failed',
    };
  }
}
