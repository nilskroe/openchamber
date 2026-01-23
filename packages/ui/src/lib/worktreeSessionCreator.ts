/**
 * Utility for creating new sessions with auto-generated worktrees.
 */

import { toast } from '@/components/ui';
import { useChatStore } from '@/stores/useChatStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { gitFetch, deleteGitBranch } from '@/lib/gitApi';
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
 */
async function initializeWorktreeSession(
  metadata: WorktreeMetadata,
  projectDirectory: string,
  branchName: string,
): Promise<{ id: string } | null> {
  const status = await getWorktreeStatus(metadata.path).catch(() => undefined);
  const createdMetadata = status ? { ...metadata, status } : metadata;

  const sessionStore = useChatStore.getState();
  const sessionId = await sessionStore.createAndLoadSession(metadata.path);
  if (!sessionId) {
    await removeWorktree({ projectDirectory, path: metadata.path, force: true }).catch(() => undefined);
    toast.error('Failed to create session', {
      description: 'Could not create a session for the worktree.',
    });
    return null;
  }

  sessionStore.setSessionDirectory(sessionId, metadata.path);
  sessionStore.setWorktreeMetadata(sessionId, createdMetadata);

  try {
    applySessionDefaults(sessionId);
  } catch {
    // Non-critical
  }

  useDirectoryStore.getState().setDirectory(metadata.path, { showOverlay: false });

  try {
    await sessionStore.loadAllSessions();
  } catch {
    // Ignore
  }

  // Run setup commands
  const setupCommands = await getWorktreeSetupCommands(projectDirectory);
  const commandsToRun = setupCommands.filter((cmd) => cmd.trim().length > 0);

  if (commandsToRun.length > 0) {
    toast.success('Worktree created', {
      description: `Branch: ${branchName}. Running ${commandsToRun.length} setup command${commandsToRun.length === 1 ? '' : 's'}...`,
    });
    runSetupCommandsWithToasts(metadata.path, projectDirectory, commandsToRun);
  } else {
    toast.success('Worktree created', {
      description: `Branch: ${branchName}`,
    });
  }

  return { id: sessionId };
}

/**
 * Create a worktree from a remote branch, handling the case where
 * a stale local branch already exists.
 */
async function createWorktreeFromRemote(
  projectDirectory: string,
  branchName: string,
  worktreeSlug: string,
): Promise<WorktreeMetadata> {
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
 */
export async function createWorktreeSessionForBranch(
  projectDirectory: string,
  branchName: string,
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
