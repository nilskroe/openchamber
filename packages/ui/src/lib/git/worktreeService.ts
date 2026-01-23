import {
  addGitWorktree,
  deleteGitBranch,
  deleteRemoteBranch,
  getGitStatus,
  listGitWorktrees,
  removeGitWorktree,
  type GitAddWorktreePayload,
  type GitWorktreeInfo,
} from '@/lib/gitApi';
import { opencodeClient } from '@/lib/opencode/client';
import type { WorktreeMetadata } from '@/types/worktree';
import type { FilesAPI, RuntimeAPIs } from '@/lib/api/types';
import { getWorktreeSetupCommands, substituteCommandVariables } from '@/lib/openchamberConfig';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { getSettingsValue } from '@/lib/settingsStorage';
import { normalizePath as normalize, joinPath } from '@/lib/paths';

const OPENCHAMBER_ROOT = 'openchamber';
const DEFAULT_BASE_URL = import.meta.env.VITE_OPENCODE_URL || '/api';

/**
 * Get the runtime Files API if available (Desktop/VSCode).
 */
function getRuntimeFilesAPI(): FilesAPI | null {
  if (typeof window === 'undefined') return null;
  const apis = (window as typeof window & { __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs }).__OPENCHAMBER_RUNTIME_APIS__;
  return apis?.files ?? null;
}

const shortBranchLabel = (branch?: string): string => {
  if (!branch) return '';
  if (branch.startsWith('refs/heads/')) return branch.substring('refs/heads/'.length);
  if (branch.startsWith('heads/')) return branch.substring('heads/'.length);
  if (branch.startsWith('refs/')) return branch.substring('refs/'.length);
  return branch;
};

/**
 * Get the home directory from the directory store or fallback sources.
 */
const getHomeDirectory = (): string => {
  try {
    const storeHome = useDirectoryStore.getState().homeDirectory;
    if (storeHome && storeHome !== '/') return normalize(storeHome);
  } catch {
    // Store might not be initialized yet
  }

  const stored = getSettingsValue('homeDirectory');
  if (stored && stored !== '/') return normalize(stored);

  if (typeof process !== 'undefined' && process.env?.HOME) {
    return normalize(process.env.HOME);
  }

  return '';
};

/**
 * Get the global openchamber root directory.
 * Returns: ~/openchamber
 */
export const getOpenchamberRoot = (): string => {
  const home = getHomeDirectory();
  if (!home) throw new Error('Could not determine home directory for openchamber');
  return joinPath(home, OPENCHAMBER_ROOT);
};

/**
 * Extract repository name from a project path.
 * e.g., "/Users/user/openchamber/my-repo" -> "my-repo"
 */
export const extractRepoName = (projectDirectory: string): string => {
  const normalized = normalize(projectDirectory);
  if (!normalized || normalized === '/') return 'unnamed-repo';
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || 'unnamed-repo';
};

const ensureDirectory = async (path: string) => {
  try {
    await opencodeClient.createDirectory(path);
  } catch (error) {
    if (error instanceof Error && /exist/i.test(error.message)) return;
    throw error;
  }
};

export interface CreateWorktreeOptions {
  /** The repo root directory: ~/openchamber/<repo-name> */
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
 * Structure: ~/openchamber/<repo-name>/<worktree-slug>
 */
export async function resolveWorktreePath(projectDirectory: string, worktreeSlug: string): Promise<string> {
  const repoRoot = normalize(projectDirectory);
  await ensureDirectory(repoRoot);
  return joinPath(repoRoot, worktreeSlug);
}

/**
 * Create a new worktree in the repo.
 * All worktrees are siblings in the repo root directory.
 */
export async function createWorktree(options: CreateWorktreeOptions): Promise<WorktreeMetadata> {
  const { projectDirectory, worktreeSlug, branch, createBranch, startPoint } = options;
  const repoRoot = normalize(projectDirectory);
  const worktreePath = await resolveWorktreePath(repoRoot, worktreeSlug);

  const payload: GitAddWorktreePayload = {
    path: worktreePath,
    branch,
    createBranch: Boolean(createBranch),
    startPoint: startPoint?.trim() || undefined,
  };

  await addGitWorktree(repoRoot, payload);

  return {
    path: worktreePath,
    branch,
    label: shortBranchLabel(branch),
    projectDirectory: repoRoot,
    relativePath: worktreeSlug,
  };
}

export async function removeWorktree(options: RemoveWorktreeOptions): Promise<void> {
  const { projectDirectory, path, force } = options;
  await removeGitWorktree(normalize(projectDirectory), { path, force });
}

export async function archiveWorktree(options: ArchiveWorktreeOptions): Promise<void> {
  const { projectDirectory, path, branch, force, deleteRemote, remote } = options;
  const repoRoot = normalize(projectDirectory);
  const normalizedBranch = branch.startsWith('refs/heads/')
    ? branch.substring('refs/heads/'.length)
    : branch;

  await removeGitWorktree(repoRoot, { path, force });

  if (normalizedBranch) {
    await deleteGitBranch(repoRoot, { branch: normalizedBranch, force: true });
    if (deleteRemote) {
      try {
        await deleteRemoteBranch(repoRoot, { branch: normalizedBranch, remote });
      } catch (error) {
        console.warn('Failed to delete remote branch during worktree archive:', error);
      }
    }
  }
}

/**
 * List all worktrees for a repo.
 * Works from any worktree or the repo root since they share the same .git database.
 */
export async function listWorktrees(projectDirectory: string): Promise<GitWorktreeInfo[]> {
  return listGitWorktrees(normalize(projectDirectory));
}

export async function getWorktreeStatus(worktreePath: string): Promise<WorktreeMetadata['status']> {
  const status = await getGitStatus(normalize(worktreePath));
  return {
    isDirty: !status.isClean,
    ahead: status.ahead,
    behind: status.behind,
    upstream: status.tracking,
  };
}

/**
 * Map a GitWorktreeInfo to WorktreeMetadata.
 * @param projectDirectory - The repo root: ~/openchamber/<repo-name>
 * @param info - The worktree info from git
 */
export function mapWorktreeToMetadata(projectDirectory: string, info: GitWorktreeInfo): WorktreeMetadata {
  const repoRoot = normalize(projectDirectory);
  const worktreePath = normalize(info.worktree);

  // Get relative path from repo root
  let relativePath: string;
  if (worktreePath.startsWith(`${repoRoot}/`)) {
    relativePath = worktreePath.slice(repoRoot.length + 1);
  } else {
    const segments = worktreePath.split('/').filter(Boolean);
    relativePath = segments[segments.length - 1] || worktreePath;
  }

  return {
    path: worktreePath,
    branch: info.branch ?? '',
    label: shortBranchLabel(info.branch ?? ''),
    projectDirectory: repoRoot,
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

  const substitutedCommands = commandsToRun.map(cmd =>
    substituteCommandVariables(cmd, { rootWorktreePath: projectDirectory })
  );

  try {
    const runtimeFiles = getRuntimeFilesAPI();
    if (runtimeFiles?.execCommands) {
      const result = await runtimeFiles.execCommands(substitutedCommands, worktreePath);
      return result as WorktreeSetupResult;
    }

    // Fall back to web API
    const startResponse = await fetch(`${DEFAULT_BASE_URL}/fs/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: substitutedCommands,
        cwd: worktreePath,
        background: true,
      }),
    });

    const startPayload = await startResponse.json().catch(() => null);

    if (startResponse.status === 202 && startPayload?.jobId) {
      const jobId = startPayload.jobId as string;
      const pollIntervalMs = 800;
      const timeoutMs = Math.max(5 * 60_000, substitutedCommands.length * 60_000);
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        const pollResponse = await fetch(`${DEFAULT_BASE_URL}/fs/exec/${jobId}`);
        const pollPayload = await pollResponse.json().catch(() => null);

        if (!pollResponse.ok) {
          return {
            success: false,
            results: substitutedCommands.map((cmd) => ({
              command: cmd,
              success: false,
              error: pollPayload?.error || 'Failed to poll exec job',
            })),
          };
        }

        if (pollPayload?.status === 'done') {
          return {
            success: pollPayload?.success === true,
            results: Array.isArray(pollPayload?.results) ? pollPayload.results : [],
          };
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
      return {
        success: false,
        results: substitutedCommands.map((cmd) => ({
          command: cmd,
          success: false,
          error: startPayload?.error || 'Request failed',
        })),
      };
    }

    return startPayload as WorktreeSetupResult;
  } catch (error) {
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
