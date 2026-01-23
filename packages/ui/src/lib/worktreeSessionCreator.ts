/**
 * Utility for creating new sessions with auto-generated worktrees.
 */

import { toast } from '@/components/ui';
import { useChatStore } from '@/stores/useChatStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { usePaneStore } from '@/stores/usePaneStore';
import { gitFetch, deleteGitBranch, fetchPRBranch } from '@/lib/gitApi';
import { generateUniqueBranchName } from '@/lib/git/branchNameGenerator';
import {
  createWorktree,
  getWorktreeStatus,
  removeWorktree,
  runWorktreeSetupCommands,
} from '@/lib/git/worktreeService';
import { getWorktreeSetupCommands } from '@/lib/openchamberConfig';
import { startConfigUpdate, finishConfigUpdate } from '@/lib/configUpdate';
import type { WorktreeMetadata } from '@/types/worktree';

const sanitizeWorktreeSlug = (value: string): string => {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 120);
};

let isCreatingWorktreeSession = false;

/**
 * Apply default agent and model settings to a newly created session.
 */
function applySessionDefaults(sessionId: string): void {
  const configState = useConfigStore.getState();
  const visibleAgents = configState.getVisibleAgents();

  // Priority: settingsDefaultAgent → build → first visible
  let agentName: string | undefined;
  if (configState.settingsDefaultAgent) {
    const match = visibleAgents.find((a) => a.name === configState.settingsDefaultAgent);
    if (match) agentName = match.name;
  }
  if (!agentName) {
    agentName = visibleAgents.find((a) => a.name === 'build')?.name || visibleAgents[0]?.name;
  }
  if (!agentName) return;

  configState.setAgent(agentName);
  useChatStore.getState().saveAgentSelection(agentName);

  const settingsDefaultModel = configState.settingsDefaultModel;
  if (!settingsDefaultModel) return;

  const parts = settingsDefaultModel.split('/');
  if (parts.length !== 2) return;

  const [providerId, modelId] = parts;
  if (!configState.getModelMetadata(providerId, modelId)) return;

  const chatStore = useChatStore.getState();
  chatStore.saveModelSelection(providerId, modelId);
  chatStore.saveAgentModelSelection(agentName, providerId, modelId);

  const settingsDefaultVariant = configState.settingsDefaultVariant;
  if (!settingsDefaultVariant) return;

  const provider = configState.providers.find((p) => p.id === providerId);
  const model = provider?.models.find((m: Record<string, unknown>) => (m as { id?: string }).id === modelId) as
    | { variants?: Record<string, unknown> }
    | undefined;

  if (model?.variants && Object.prototype.hasOwnProperty.call(model.variants, settingsDefaultVariant)) {
    configState.setCurrentVariant(settingsDefaultVariant);
    chatStore.saveAgentModelVariantSelection(agentName, providerId, modelId, settingsDefaultVariant);
  }
}

/**
 * Run worktree setup commands and show toast notifications for results.
 */
function runSetupCommandsWithToasts(
  worktreePath: string,
  projectDirectory: string,
  commands: string[],
): void {
  runWorktreeSetupCommands(worktreePath, projectDirectory, commands)
    .then((result) => {
      if (result.success) {
        toast.success('Setup commands completed', {
          description: `All ${result.results.length} command${result.results.length === 1 ? '' : 's'} succeeded.`,
        });
      } else {
        const failed = result.results.filter((r) => !r.success);
        const succeeded = result.results.filter((r) => r.success);
        toast.error('Setup commands failed', {
          description:
            `${failed.length} of ${result.results.length} command${result.results.length === 1 ? '' : 's'} failed.` +
            (succeeded.length > 0 ? ` ${succeeded.length} succeeded.` : ''),
        });
      }
    })
    .catch(() => {
      toast.error('Setup commands failed', {
        description: 'Could not execute setup commands.',
      });
    });
}

/**
 * Core logic: given worktree metadata, create a session, apply defaults, and run setup.
 * Returns the session or null if session creation failed.
 *
 * Optimized for speed: session creation and UI navigation happen first,
 * then background tasks (status check, session list refresh) run afterward.
 */
async function initializeWorktreeSession(
  metadata: WorktreeMetadata,
  projectDirectory: string,
  branchName: string,
): Promise<{ id: string } | null> {
  const sessionStore = useChatStore.getState();

  // Create session first (critical path)
  const sessionId = await sessionStore.createAndLoadSession(metadata.path);
  if (!sessionId) {
    await removeWorktree({ projectDirectory, path: metadata.path, force: true }).catch(() => undefined);
    toast.error('Failed to create session', {
      description: 'Could not create a session for the worktree.',
    });
    return null;
  }

  // Set session directory immediately (needed for chat to work)
  sessionStore.setSessionDirectory(sessionId, metadata.path);
  sessionStore.setWorktreeMetadata(sessionId, metadata);

  // Apply defaults and navigate (critical path)
  try {
    applySessionDefaults(sessionId);
  } catch {
    // Non-critical
  }

  // Initialize panes and add chat tab BEFORE switching directories.
  // This ensures the pane state is ready when the UI re-renders after setDirectory.
  const paneStore = usePaneStore.getState();
  paneStore.initializeWorktree(metadata.path);
  paneStore.addTab(metadata.path, 'left', {
    type: 'chat',
    title: 'Chat',
    sessionId,
  });

  // Now switch to the new directory - the UI will re-render with the panes already set up
  useDirectoryStore.getState().setDirectory(metadata.path, { showOverlay: false });

  // Show success toast early so user knows worktree is ready
  const setupCommands = await getWorktreeSetupCommands(projectDirectory);
  const commandsToRun = setupCommands.filter((cmd) => cmd.trim().length > 0);

  if (commandsToRun.length > 0) {
    toast.success('Worktree created', {
      description: `Branch: ${branchName}. Running ${commandsToRun.length} setup command${commandsToRun.length === 1 ? '' : 's'}...`,
    });
  } else {
    toast.success('Worktree created', {
      description: `Branch: ${branchName}`,
    });
  }

  // Run background tasks (non-blocking) to update UI and get additional info
  // These run in the background so the worktree is usable immediately
  Promise.all([
    // Update worktree metadata with status (for UI indicators)
    getWorktreeStatus(metadata.path).then((status) => {
      if (status) {
        sessionStore.setWorktreeMetadata(sessionId, { ...metadata, status });
      }
    }).catch(() => undefined),

    // Refresh session list for sidebar
    sessionStore.loadAllSessions().catch(() => undefined),

    // Refresh worktree list so the sidebar picks up the new worktree
    sessionStore.refreshWorktrees().catch(() => undefined),

    // Run setup commands (already non-blocking)
    commandsToRun.length > 0
      ? runSetupCommandsWithToasts(metadata.path, projectDirectory, commandsToRun)
      : Promise.resolve(),
  ]).catch(() => {
    // Ignore background task errors
  });

  return { id: sessionId };
}

/**
 * Create a worktree from a remote branch, handling the case where
 * a stale local branch already exists.
 *
 * @param projectDirectory - The project directory (main clone)
 * @param branchName - The branch name to create the worktree for
 * @param worktreeSlug - The slug for the worktree directory
 * @param prNumber - Optional PR number. If provided, fetches using `pull/<number>/head` refspec
 *                   which is necessary for PRs from forks where the branch doesn't exist on origin.
 */
async function createWorktreeFromRemote(
  projectDirectory: string,
  branchName: string,
  worktreeSlug: string,
  prNumber?: number,
): Promise<WorktreeMetadata> {
  // If a PR number is provided, fetch the PR branch first
  // This is necessary for PRs from forks where the branch doesn't exist on origin
  if (prNumber) {
    try {
      await fetchPRBranch(projectDirectory, prNumber, branchName);
      // Now create the worktree from the local branch we just fetched
      return await createWorktree({
        projectDirectory,
        worktreeSlug,
        branch: branchName,
        createBranch: false, // Branch already exists from fetchPRBranch
      });
    } catch (error) {
      // If PR fetch fails, fall through to try the regular approach
      console.warn('Failed to fetch PR branch, trying regular approach:', error);
    }
  }

  try {
    return await createWorktree({
      projectDirectory,
      worktreeSlug,
      branch: branchName,
      createBranch: true,
      startPoint: `origin/${branchName}`,
    });
  } catch {
    // Branch likely exists locally - delete and retry from remote
    try {
      await deleteGitBranch(projectDirectory, { branch: branchName, force: true });
      return await createWorktree({
        projectDirectory,
        worktreeSlug,
        branch: branchName,
        createBranch: true,
        startPoint: `origin/${branchName}`,
      });
    } catch {
      // Last resort: use existing local branch
      return await createWorktree({
        projectDirectory,
        worktreeSlug,
        branch: branchName,
        createBranch: false,
      });
    }
  }
}

/**
 * Create a new session with an auto-generated worktree.
 * Uses the active project's worktree defaults (branch prefix, base branch).
 */
export async function createWorktreeSession(): Promise<{ id: string } | null> {
  if (isCreatingWorktreeSession) return null;

  const activeProject = useProjectsStore.getState().getActiveProject();
  if (!activeProject?.path) {
    toast.error('No active project', { description: 'Please select a project first.' });
    return null;
  }

  const projectDirectory = activeProject.path;

  isCreatingWorktreeSession = true;
  startConfigUpdate('Creating new worktree session...');

  try {
    await gitFetch(projectDirectory, { remote: 'origin' }).catch(() => undefined);

    const { branchPrefix, baseBranch } = activeProject.worktreeDefaults ?? {};
    const branchName = await generateUniqueBranchName(projectDirectory, branchPrefix);
    if (!branchName) {
      toast.error('Failed to generate branch name', { description: 'Could not generate a unique branch name.' });
      return null;
    }

    const metadata = await createWorktree({
      projectDirectory,
      worktreeSlug: sanitizeWorktreeSlug(branchName),
      branch: branchName,
      createBranch: true,
      startPoint: baseBranch && baseBranch !== 'HEAD' ? `origin/${baseBranch}` : undefined,
    });

    return await initializeWorktreeSession(metadata, projectDirectory, branchName);
  } catch (error) {
    toast.error('Failed to create worktree', {
      description: error instanceof Error ? error.message : 'Failed to create worktree session',
    });
    return null;
  } finally {
    finishConfigUpdate();
    isCreatingWorktreeSession = false;
  }
}

/**
 * Check if a worktree session is currently being created.
 */
export function isCreatingWorktree(): boolean {
  return isCreatingWorktreeSession;
}

/**
 * Create a new session with a worktree for a specific branch.
 * Fetches from origin and creates the worktree from the latest remote state.
 *
 * @param projectDirectory - The project directory (main clone)
 * @param branchName - The branch name to create the worktree for
 * @param prNumber - Optional PR number. If provided, uses `pull/<number>/head` refspec to fetch
 *                   the branch, which is necessary for PRs from forks.
 */
export async function createWorktreeSessionForBranch(
  projectDirectory: string,
  branchName: string,
  prNumber?: number,
): Promise<{ id: string } | null> {
  if (isCreatingWorktreeSession) return null;

  isCreatingWorktreeSession = true;
  startConfigUpdate('Creating worktree session...');

  try {
    await gitFetch(projectDirectory, { remote: 'origin' }).catch(() => undefined);

    const metadata = await createWorktreeFromRemote(
      projectDirectory,
      branchName,
      sanitizeWorktreeSlug(branchName),
      prNumber,
    );

    return await initializeWorktreeSession(metadata, projectDirectory, branchName);
  } catch (error) {
    toast.error('Failed to create worktree', {
      description: error instanceof Error ? error.message : 'Failed to create worktree session',
    });
    return null;
  } finally {
    finishConfigUpdate();
    isCreatingWorktreeSession = false;
  }
}
