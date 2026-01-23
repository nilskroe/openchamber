import type { Session, Message, Part } from "@opencode-ai/sdk/v2";
import type { PermissionRequest, PermissionResponse } from "@/types/permission";
import type { QuestionRequest } from "@/types/question";
import type { WorktreeMetadata } from "@/types/worktree";

export interface AttachedFile {
  id: string;
  file: File;
  dataUrl: string;
  mimeType: string;
  filename: string;
  size: number;
  source: "local" | "server";
  serverPath?: string;
}

export type EditPermissionMode = 'allow' | 'ask' | 'deny' | 'full';

export type MessageStreamPhase = 'streaming' | 'cooldown' | 'completed';

export interface MessageStreamLifecycle {
  phase: MessageStreamPhase;
  startedAt: number;
  lastUpdateAt: number;
  completedAt?: number;
}

export interface MessageEntry {
  info: Message & Record<string, unknown>;
  parts: Part[];
}

export interface ContextUsage {
  totalTokens: number;
  percentage: number;
  contextLimit: number;
  outputLimit?: number;
  normalizedOutput?: number;
  thresholdLimit: number;
  lastMessageId?: string;
}

export type ActivityPhase = 'idle' | 'busy' | 'cooldown';

export interface ChatState {
  // Session identity
  currentSessionId: string | null;
  currentDirectory: string | null;
  sessionTitle: string;
  session: Session | null;

  // Messages — flat array for current session only
  messages: MessageEntry[];
  streamingMessageId: string | null;
  messageStreamStates: Map<string, MessageStreamLifecycle>;
  isStreaming: boolean;
  streamStartTime: number | undefined;

  // Permissions & Questions — flat arrays for current session
  permissions: PermissionRequest[];
  questions: QuestionRequest[];

  // Context & Model selections
  modelSelection: { providerId: string; modelId: string } | null;
  agentSelection: string | null;
  agentModelSelections: Record<string, { providerId: string; modelId: string }>;
  agentModelVariantSelections: Record<string, Record<string, string>>; // agentName → "providerId/modelId" → variant
  currentAgentContext: string | undefined;
  contextUsage: ContextUsage | null;

  // Edit permission modes (per-agent, not per-session)
  agentEditModes: Record<string, EditPermissionMode>;

  // Activity
  activityPhase: ActivityPhase;
  isLoading: boolean;
  isSyncing: boolean;
  abortController: AbortController | null;
  lastUsedProvider: { providerID: string; modelID: string } | null;

  // Pending streaming state
  pendingAssistantHeader: boolean;
  pendingUserMessageMeta: { mode?: string; providerID?: string; modelID?: string; variant?: string } | null;
  sessionAbortTimestamp: number | null;

  // Session compaction tracking
  compactionUntil: number | null;

  // Total available messages for "load more"
  totalAvailableMessages: number;
  hasMoreAbove: boolean;

  // Pending input text (populated by revert/fork, consumed by ChatInput)
  pendingInputText: string | null;

  // Abort prompt (brief confirmation window before abort)
  abortPromptExpiresAt: number | null;

  // Session listing (for sidebar/management views, not the active chat)
  allSessions: Session[];
  availableWorktreesByProject: Map<string, WorktreeMetadata[]>;
  worktreesLoaded: boolean; // True after first successful refreshWorktrees() call
  worktreeMetadata: Map<string, WorktreeMetadata>;
  sessionDirectories: Map<string, string>;
}

export interface ChatActions {
  // Session lifecycle
  loadSession: (directory: string) => Promise<void>;
  createAndLoadSession: (directory: string, title?: string) => Promise<string | null>;
  clearSession: () => void;

  // Messages
  loadMessages: (limit?: number) => Promise<void>;
  sendMessage: (
    content: string,
    providerID: string,
    modelID: string,
    agent?: string,
    attachments?: AttachedFile[],
    agentMentionName?: string | null,
    additionalParts?: Array<{ text: string; attachments?: AttachedFile[] }>,
    variant?: string
  ) => Promise<void>;
  abortCurrentOperation: () => Promise<void>;
  syncMessages: (incoming: { info: Message; parts: Part[] }[]) => void;
  loadMoreMessages: (direction: "up" | "down") => Promise<void>;

  // Streaming
  addStreamingPart: (messageId: string, part: Part, role?: string) => void;
  completeStreamingMessage: (messageId: string) => void;
  forceCompleteMessage: (messageId: string, source?: "timeout" | "cooldown") => void;
  markMessageStreamSettled: (messageId: string) => void;
  updateMessageInfo: (messageId: string, messageInfo: Record<string, unknown>) => void;

  // Permissions
  addPermission: (permission: PermissionRequest) => void;
  respondToPermission: (requestId: string, response: PermissionResponse) => Promise<void>;

  // Questions
  addQuestion: (question: QuestionRequest) => void;
  dismissQuestion: (requestId: string) => void;
  respondToQuestion: (requestId: string, answers: string[] | string[][]) => Promise<void>;
  rejectQuestion: (requestId: string) => Promise<void>;

  // Context & Model
  saveModelSelection: (providerId: string, modelId: string) => void;
  saveAgentSelection: (agentName: string) => void;
  saveAgentModelSelection: (agentName: string, providerId: string, modelId: string) => void;
  getAgentModelSelection: (agentName: string) => { providerId: string; modelId: string } | null;
  saveAgentModelVariantSelection: (agentName: string, providerId: string, modelId: string, variant: string | undefined) => void;
  getAgentModelVariantSelection: (agentName: string, providerId: string, modelId: string) => string | undefined;
  updateContextUsage: (contextLimit: number, outputLimit: number) => void;
  setCurrentAgentContext: (agentName: string | undefined) => void;
  analyzeAndSaveExternalSessionChoices: (agents: Array<{ name: string; [key: string]: unknown }>) => Promise<Record<string, { providerId: string; modelId: string; timestamp: number }>>;

  // Edit permission modes
  getAgentEditMode: (agentName: string | undefined, defaultMode?: EditPermissionMode) => EditPermissionMode;
  setAgentEditMode: (agentName: string | undefined, mode: EditPermissionMode, defaultMode?: EditPermissionMode) => void;
  toggleAgentEditMode: (agentName: string | undefined, defaultMode?: EditPermissionMode) => void;

  // Session metadata
  updateSessionTitle: (title: string) => Promise<void>;
  updateSession: (session: Session) => void;
  updateCompaction: (compactingTimestamp: number | null | undefined) => void;
  acknowledgeAbort: () => void;
  getLastMessageModel: () => { providerID?: string; modelID?: string } | null;

  // Pending input
  setPendingInputText: (text: string | null) => void;
  consumePendingInputText: () => string | null;

  // Abort prompt
  armAbortPrompt: (durationMs?: number) => number | null;
  clearAbortPrompt: () => void;

  // Revert / Fork
  revertToMessage: (messageId: string) => Promise<void>;
  handleSlashUndo: () => Promise<void>;
  handleSlashRedo: () => Promise<void>;
  forkFromMessage: (messageId: string) => Promise<void>;

  // Cleanup
  cleanupSession: () => void;

  // Session listing & management (for sidebar/management views)
  loadAllSessions: () => Promise<void>;
  deleteSession: (id: string, options?: { archiveWorktree?: boolean; deleteRemoteBranch?: boolean; remoteName?: string }) => Promise<boolean>;
  deleteSessions: (ids: string[], options?: { archiveWorktree?: boolean; deleteRemoteBranch?: boolean; remoteName?: string; silent?: boolean }) => Promise<{ deletedIds: string[]; failedIds: string[] }>;
  getWorktreeMetadata: (sessionId: string) => WorktreeMetadata | undefined;
  setWorktreeMetadata: (sessionId: string, metadata: WorktreeMetadata) => void;
  setSessionDirectory: (sessionId: string, directory: string) => void;
  refreshWorktrees: () => Promise<void>;

  // Internal (used by addStreamingPart batch processing)
  _addStreamingPartDirect: (messageId: string, part: Part, role?: string) => void;
}

export type ChatStore = ChatState & ChatActions;
