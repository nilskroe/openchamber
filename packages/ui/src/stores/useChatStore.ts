/* eslint-disable @typescript-eslint/no-explicit-any */
import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import type { Message, Part, Session } from "@opencode-ai/sdk/v2";
import { opencodeClient } from "@/lib/opencode/client";
import { isExecutionForkMetaText } from "@/lib/messages/executionMeta";
import type {
  ChatStore,
  ChatState,
  MessageEntry,
  MessageStreamLifecycle,
  ContextUsage,
  AttachedFile,
  EditPermissionMode,
} from "./types/chatTypes";
import type { PermissionRequest, PermissionResponse } from "@/types/permission";
import type { QuestionRequest } from "@/types/question";
import { extractTextFromPart, normalizeStreamingPart } from "./utils/messageUtils";
import { isEditPermissionType, getAgentDefaultEditPermission } from "./utils/permissionUtils";
import { extractTokensFromMessage } from "./utils/tokenUtils";
import { calculateContextUsage } from "./utils/contextUtils";
import { settingsFileStorage } from "@/lib/settingsStorage";
import { useFileStore } from "./fileStore";
import { normalizePath } from "@/lib/paths";
import { listWorktrees, mapWorktreeToMetadata } from "@/lib/git/worktreeService";
import { useProjectsStore } from "./useProjectsStore";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ZOMBIE_TIMEOUT = 10 * 60 * 1000;
const STREAMING_TIMEOUT = 30_000;
const BATCH_INTERVAL = 50;
const EDIT_PERMISSION_SEQUENCE: EditPermissionMode[] = ['ask', 'allow', 'full'];

const computePartsTextLength = (parts: Part[]): number => {
  return parts.reduce((sum, part) => {
    const text = extractTextFromPart(part);
    if (text) return sum + text.length;
    return sum;
  }, 0);
};

const hasFinishStop = (info: { finish?: string } | undefined): boolean => {
  return info?.finish === "stop";
};

const getPartKey = (part: Part | undefined): string | undefined => {
  if (!part) return undefined;
  if (typeof part.id === "string" && part.id.length > 0) return part.id;
  if (part.type) {
    const reason = (part as Record<string, unknown>).reason;
    const callId = (part as Record<string, unknown>).callID;
    return `${part.type}-${reason ?? ""}-${callId ?? ""}`;
  }
  return undefined;
};

const mergePreferExistingParts = (existing: Part[] = [], incoming: Part[] = []): Part[] => {
  if (!incoming.length) return [...existing];
  const merged = [...existing];
  const existingKeys = new Set(existing.map(getPartKey).filter((key): key is string => Boolean(key)));
  for (const part of incoming) {
    if (!part) continue;
    const key = getPartKey(part);
    if (key && existingKeys.has(key)) continue;
    merged.push(part);
    if (key) existingKeys.add(key);
  }
  return merged;
};

const mergeDuplicateMessage = (
  existing: MessageEntry,
  incoming: MessageEntry
): MessageEntry => {
  const existingParts = Array.isArray(existing.parts) ? existing.parts : [];
  const incomingParts = Array.isArray(incoming.parts) ? incoming.parts : [];
  const existingLen = computePartsTextLength(existingParts);
  const incomingLen = computePartsTextLength(incomingParts);
  const existingStop = hasFinishStop(existing.info as any);
  const incomingStop = hasFinishStop(incoming.info as any);

  let parts = incomingParts;
  if (existingStop && existingLen >= incomingLen) {
    parts = mergePreferExistingParts(existingParts, incomingParts);
  } else if (incomingStop && incomingLen >= existingLen) {
    parts = mergePreferExistingParts(incomingParts, existingParts);
  } else if (existingLen >= incomingLen) {
    parts = existingParts;
  }

  return {
    info: { ...existing.info, ...incoming.info } as Message & Record<string, unknown>,
    parts,
  };
};

const dedupeMessagesById = (messages: MessageEntry[]): MessageEntry[] => {
  const deduped: MessageEntry[] = [];
  const indexById = new Map<string, number>();

  for (const message of messages) {
    const messageId = typeof message?.info?.id === "string" ? message.info.id : null;
    if (!messageId) {
      deduped.push(message);
      continue;
    }
    const existingIndex = indexById.get(messageId);
    if (existingIndex === undefined) {
      indexById.set(messageId, deduped.length);
      deduped.push(message);
    } else {
      deduped[existingIndex] = mergeDuplicateMessage(deduped[existingIndex], message);
    }
  }
  return deduped;
};

// Streaming timeout tracking
const timeoutRegistry = new Map<string, ReturnType<typeof setTimeout>>();
const lastContentRegistry = new Map<string, number>();
const lifecycleCompletionTimers = new Map<string, ReturnType<typeof setTimeout>>();

const clearLifecycleCompletionTimer = (messageId: string) => {
  const timer = lifecycleCompletionTimers.get(messageId);
  if (timer) {
    clearTimeout(timer);
    lifecycleCompletionTimers.delete(messageId);
  }
};

// Batch queue for streaming parts
let batchQueue: Array<{ messageId: string; part: Part; role?: string }> = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

const ignoredMessageIds = new Set<string>();

// ─── Store ────────────────────────────────────────────────────────────────────

const initialState: ChatState = {
  currentSessionId: null,
  currentDirectory: null,
  sessionTitle: "",
  session: null,

  messages: [],
  streamingMessageId: null,
  messageStreamStates: new Map(),
  isStreaming: false,
  streamStartTime: undefined,

  permissions: [],
  questions: [],

  modelSelection: null,
  agentSelection: null,
  agentModelSelections: {},
  agentModelVariantSelections: {},
  currentAgentContext: undefined,
  contextUsage: null,

  agentEditModes: {},

  activityPhase: 'idle',
  isLoading: false,
  isSyncing: false,
  abortController: null,
  lastUsedProvider: null,

  pendingAssistantHeader: false,
  pendingUserMessageMeta: null,
  sessionAbortTimestamp: null,

  compactionUntil: null,

  totalAvailableMessages: 0,
  hasMoreAbove: false,

  pendingInputText: null,
  abortPromptExpiresAt: null,

  allSessions: [],
  availableWorktreesByProject: new Map(),
  worktreeMetadata: new Map(),
  sessionDirectories: new Map(),
};

export const useChatStore = create<ChatStore>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        // ─── Session Lifecycle ──────────────────────────────────────────────

        loadSession: async (directory: string) => {
          const state = get();
          if (state.currentDirectory === directory && state.currentSessionId) {
            // Already loaded for this directory
            return;
          }

          set({ isLoading: true, currentDirectory: directory });

          try {
            // Load sessions for this directory
            const sessions = await opencodeClient.withDirectory(directory, () =>
              opencodeClient.listSessions()
            );

            if (!sessions || sessions.length === 0) {
              // Create a new session for this worktree
              const session = await opencodeClient.withDirectory(directory, () =>
                opencodeClient.createSession()
              );
              if (session) {
                set({
                  currentSessionId: session.id,
                  session,
                  sessionTitle: session.title || "",
                  isLoading: false,
                });
                await get().loadMessages();
              } else {
                set({ isLoading: false });
              }
              return;
            }

            // Use the most recent session
            const sorted = [...sessions].sort((a, b) => {
              const aTime = (a as any).time?.updated || (a as any).time?.created || 0;
              const bTime = (b as any).time?.updated || (b as any).time?.created || 0;
              return bTime - aTime;
            });

            const session = sorted[0];
            set({
              currentSessionId: session.id,
              session,
              sessionTitle: session.title || "",
              isLoading: false,
            });
            await get().loadMessages();
          } catch (error) {
            console.warn("Failed to load session for directory:", directory, error);
            set({ isLoading: false });
          }
        },

        createAndLoadSession: async (directory: string, title?: string) => {
          set({ isLoading: true, currentDirectory: directory });
          try {
            const session = await opencodeClient.withDirectory(directory, () =>
              opencodeClient.createSession({ title })
            );
            if (session) {
              set({
                currentSessionId: session.id,
                session,
                sessionTitle: session.title || title || "",
                messages: [],
                streamingMessageId: null,
                messageStreamStates: new Map(),
                isStreaming: false,
                permissions: [],
                questions: [],
                contextUsage: null,
                activityPhase: 'idle',
                isLoading: false,
                pendingAssistantHeader: false,
                pendingUserMessageMeta: null,
                sessionAbortTimestamp: null,
                totalAvailableMessages: 0,
                hasMoreAbove: false,
              });
              return session.id;
            }
          } catch (error) {
            console.warn("Failed to create session:", error);
          }
          set({ isLoading: false });
          return null;
        },

        clearSession: () => {
          set({
            ...initialState,
          });
        },

        // ─── Messages ───────────────────────────────────────────────────────

        loadMessages: async (limit?: number) => {
          const { currentSessionId, currentDirectory } = get();
          if (!currentSessionId) return;

          const noLimit = limit === Infinity;
          const effectiveLimit = noLimit ? undefined : (limit ?? 90);
          const fetchLimit = noLimit ? undefined : (effectiveLimit ? effectiveLimit + 20 : undefined);

          try {
            const allMessages = await opencodeClient.withDirectory(
              currentDirectory ?? undefined,
              () => opencodeClient.getSessionMessages(currentSessionId!, fetchLimit)
            );

            const messagesToKeep = effectiveLimit
              ? allMessages.slice(-effectiveLimit)
              : allMessages;

            set((state) => {
              const previousMessagesById = new Map(
                state.messages
                  .filter((msg) => typeof msg.info?.id === "string")
                  .map((msg) => [msg.info.id as string, msg])
              );

              const normalizedMessages = messagesToKeep.map((message) => {
                const infoWithMarker = {
                  ...message.info,
                  clientRole: (message.info as any)?.clientRole ?? message.info.role,
                  userMessageMarker: message.info.role === "user" ? true : (message.info as any)?.userMessageMarker,
                } as any;

                const serverParts = (Array.isArray(message.parts) ? message.parts : []).map((part) => {
                  if (part?.type === 'text') {
                    const raw = (part as any).text ?? (part as any).content ?? '';
                    if (isExecutionForkMetaText(raw)) {
                      return { ...part, synthetic: true } as Part;
                    }
                  }
                  return part;
                });

                const existingEntry = infoWithMarker?.id
                  ? previousMessagesById.get(infoWithMarker.id as string)
                  : undefined;

                if (existingEntry && existingEntry.info.role === "assistant") {
                  const existingParts = Array.isArray(existingEntry.parts) ? existingEntry.parts : [];
                  const existingLen = computePartsTextLength(existingParts);
                  const serverLen = computePartsTextLength(serverParts);
                  const storeHasStop = hasFinishStop(existingEntry.info);

                  if (storeHasStop && existingLen > serverLen) {
                    return {
                      info: infoWithMarker,
                      parts: mergePreferExistingParts(existingParts, serverParts),
                    };
                  }
                }

                return { info: infoWithMarker, parts: serverParts };
              });

              const mergedMessages = dedupeMessagesById(normalizedMessages);

              return {
                messages: mergedMessages,
                isStreaming: false,
                totalAvailableMessages: allMessages.length,
                hasMoreAbove: allMessages.length > messagesToKeep.length,
              };
            });
          } catch (error) {
            console.warn("Failed to load messages:", error);
          }
        },

        sendMessage: async (
          content: string,
          providerID: string,
          modelID: string,
          agent?: string,
          attachments?: AttachedFile[],
          agentMentionName?: string | null,
          additionalParts?: Array<{ text: string; attachments?: AttachedFile[] }>,
          variant?: string
        ) => {
          const { currentSessionId, currentDirectory } = get();
          if (!currentSessionId) {
            throw new Error("No session selected");
          }

          // Clear any lingering abort flags
          if (get().sessionAbortTimestamp) {
            set({ sessionAbortTimestamp: null });
          }

          const executeOp = async () => {
            try {
              let effectiveContent = content;
              const isCommand = content.startsWith("/");

              if (isCommand) {
                const spaceIndex = content.indexOf(" ");
                const command = spaceIndex === -1 ? content.substring(1) : content.substring(1, spaceIndex);
                const commandArgs = spaceIndex === -1 ? "" : content.substring(spaceIndex + 1).trim();

                const apiClient = opencodeClient.getApiClient();

                if (command === "init") {
                  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                  await apiClient.session.init({
                    sessionID: currentSessionId,
                    ...(currentDirectory ? { directory: currentDirectory } : {}),
                    messageID: messageId,
                    providerID,
                    modelID,
                  });
                  return;
                }

                if (command === "summarize") {
                  await apiClient.session.summarize({
                    sessionID: currentSessionId,
                    ...(currentDirectory ? { directory: currentDirectory } : {}),
                    providerID,
                    modelID,
                  });
                  return;
                }

                try {
                  const commandDetails = await opencodeClient.getCommandDetails(command);
                  if (commandDetails?.template) {
                    effectiveContent = commandDetails.template.replace(/\$ARGUMENTS/g, commandArgs);
                  }
                } catch {
                  // Use original content if command resolution fails
                }
              }

              set({
                lastUsedProvider: { providerID, modelID },
                isStreaming: true,
                streamStartTime: Date.now(),
                activityPhase: 'busy',
                pendingAssistantHeader: true,
                pendingUserMessageMeta: {
                  mode: typeof agent === 'string' && agent.trim().length > 0 ? agent.trim() : undefined,
                  providerID,
                  modelID,
                  variant: typeof variant === 'string' && variant.trim().length > 0 ? variant : undefined,
                },
              });

              const controller = new AbortController();
              set({ abortController: controller });

              const filePayloads = (attachments ?? []).map((file) => ({
                type: "file" as const,
                mime: file.mimeType,
                filename: file.filename,
                url: file.dataUrl,
              }));

              const additionalPartsPayload = additionalParts?.map((part) => ({
                text: part.text,
                files: part.attachments?.map((file) => ({
                  type: "file" as const,
                  mime: file.mimeType,
                  filename: file.filename,
                  url: file.dataUrl,
                })),
              }));

              await opencodeClient.sendMessage({
                id: currentSessionId,
                providerID,
                modelID,
                text: effectiveContent,
                agent,
                variant,
                files: filePayloads.length > 0 ? filePayloads : undefined,
                additionalParts: additionalPartsPayload,
                agentMentions: agentMentionName ? [{ name: agentMentionName }] : undefined,
              });

              if (filePayloads.length > 0) {
                try {
                  useFileStore.getState().clearAttachedFiles();
                } catch {
                  // ignore
                }
              }

              set({ abortController: null });
            } catch (error: any) {
              let errorMessage = "Network error while sending message.";
              if (error.name === "AbortError") {
                errorMessage = "Request timed out.";
              } else if (error.message?.includes("504") || error.message?.includes("Gateway")) {
                errorMessage = "Gateway timeout - your message is being processed.";
                set({ abortController: null });
                return;
              } else if (error.response?.status === 401) {
                errorMessage = "Session not found or unauthorized.";
              } else if (error.response?.status === 502) {
                errorMessage = "OpenCode is restarting. Please wait.";
              } else if (error.message) {
                errorMessage = error.message;
              }

              set({
                abortController: null,
                pendingAssistantHeader: false,
                pendingUserMessageMeta: null,
              });
              throw new Error(errorMessage);
            }
          };

          if (currentDirectory) {
            await opencodeClient.withDirectory(currentDirectory, executeOp);
          } else {
            await executeOp();
          }
        },

        abortCurrentOperation: async () => {
          const { currentSessionId, abortController, messages, messageStreamStates } = get();
          if (!currentSessionId) return;

          abortController?.abort();

          // Find active streaming message IDs
          const activeIds = new Set<string>();
          const currentStreamingId = get().streamingMessageId;
          if (currentStreamingId) activeIds.add(currentStreamingId);

          messageStreamStates.forEach((_lifecycle, messageId) => {
            activeIds.add(messageId);
          });

          if (activeIds.size === 0) {
            // Fallback: find last assistant message with working parts
            for (let i = messages.length - 1; i >= 0; i--) {
              const message = messages[i];
              if (message.info.role !== 'assistant') continue;
              const hasWorkingPart = (message.parts ?? []).some((part) =>
                part.type === 'reasoning' || part.type === 'tool' || part.type === 'step-start'
              );
              if (hasWorkingPart) {
                activeIds.add(message.info.id);
                break;
              }
              if (activeIds.size === 0) {
                activeIds.add(message.info.id);
              }
            }
          }

          // Clear timers
          Array.from(activeIds).forEach((id) => {
            const timeout = timeoutRegistry.get(id);
            if (timeout) {
              clearTimeout(timeout);
              timeoutRegistry.delete(id);
              lastContentRegistry.delete(id);
            }
            clearLifecycleCompletionTimer(id);
          });

          const abortTimestamp = Date.now();

          set((state) => {
            // Remove lifecycle entries for active IDs
            const nextStates = new Map(state.messageStreamStates);
            Array.from(activeIds).forEach((id) => nextStates.delete(id));

            // Update messages: mark tool parts as aborted, close reasoning
            const updatedMessages = state.messages.map((message) => {
              if (!activeIds.has(message.info.id)) return message;
              const updatedParts = (message.parts ?? []).map((part) => {
                if (part.type === 'reasoning') {
                  const rp = part as any;
                  const time = { ...(rp.time ?? {}) };
                  if (typeof time.end !== 'number') time.end = abortTimestamp;
                  return { ...rp, time } as Part;
                }
                if (part.type === 'tool') {
                  const tp = part as any;
                  const stateData = { ...(tp.state ?? {}) };
                  if (stateData.status === 'running' || stateData.status === 'pending') {
                    stateData.status = 'aborted';
                  }
                  return { ...tp, state: stateData } as Part;
                }
                if (part.type === 'step-start') {
                  return { ...(part as any), type: 'step-finish', aborted: true } as Part;
                }
                return part;
              });
              return {
                info: { ...message.info, abortedAt: abortTimestamp, streaming: false, status: 'aborted' },
                parts: updatedParts,
              };
            });

            return {
              messageStreamStates: nextStates,
              messages: updatedMessages,
              isStreaming: false,
              streamStartTime: undefined,
              streamingMessageId: null,
              abortController: null,
              activityPhase: 'idle' as const,
              sessionAbortTimestamp: abortTimestamp,
              pendingAssistantHeader: false,
              pendingUserMessageMeta: null,
            };
          });

          void opencodeClient.abortSession(currentSessionId).catch((error) => {
            console.warn('Abort request failed:', error);
          });
        },

        syncMessages: (incoming: { info: Message; parts: Part[] }[]) => {
          set((state) => {
            const previousById = new Map(
              state.messages
                .filter((m) => typeof m.info?.id === "string")
                .map((m) => [m.info.id as string, m])
            );

            const normalized: MessageEntry[] = incoming.map((message) => {
              const info = {
                ...message.info,
                clientRole: (message.info as any)?.clientRole ?? message.info.role,
                userMessageMarker: message.info.role === "user" ? true : (message.info as any)?.userMessageMarker,
              } as any;

              const parts = (Array.isArray(message.parts) ? message.parts : []).map((part) => {
                if (part?.type === 'text') {
                  const raw = (part as any).text ?? (part as any).content ?? '';
                  if (isExecutionForkMetaText(raw)) {
                    return { ...part, synthetic: true } as Part;
                  }
                }
                return part;
              });

              const existing = info.id ? previousById.get(info.id) : undefined;
              if (existing && existing.info.role === "assistant") {
                const existingParts = Array.isArray(existing.parts) ? existing.parts : [];
                const existingLen = computePartsTextLength(existingParts);
                const serverLen = computePartsTextLength(parts);
                if (hasFinishStop(existing.info) && existingLen > serverLen) {
                  return { info, parts: mergePreferExistingParts(existingParts, parts) };
                }
              }
              return { info, parts };
            });

            return { messages: dedupeMessagesById(normalized) };
          });
        },

        loadMoreMessages: async (direction: "up" | "down") => {
          const { currentSessionId, currentDirectory, messages } = get();
          if (!currentSessionId || direction !== "up") return;

          try {
            const allMessages = await opencodeClient.withDirectory(
              currentDirectory ?? undefined,
              () => opencodeClient.getSessionMessages(currentSessionId!)
            );

            // Prepend older messages not already in the store
            const existingIds = new Set(messages.map((m) => m.info.id));
            const olderMessages: MessageEntry[] = allMessages
              .filter((m) => !existingIds.has(m.info.id))
              .map((m) => ({
                info: { ...m.info, clientRole: (m.info as any)?.clientRole ?? m.info.role } as any,
                parts: m.parts,
              }));

            if (olderMessages.length > 0) {
              set((state) => ({
                messages: [...olderMessages, ...state.messages],
                hasMoreAbove: false,
                totalAvailableMessages: allMessages.length,
              }));
            }
          } catch (error) {
            console.warn("Failed to load more messages:", error);
          }
        },

        // ─── Streaming ──────────────────────────────────────────────────────

        addStreamingPart: (messageId: string, part: Part, role?: string) => {
          if (ignoredMessageIds.has(messageId)) return;

          const { currentSessionId } = get();
          if (!currentSessionId) return;

          // Batch user-role parts for debounced processing
          if (role === 'user') {
            batchQueue.push({ messageId, part, role });
            if (!batchTimer) {
              batchTimer = setTimeout(() => {
                const queue = batchQueue;
                batchQueue = [];
                batchTimer = null;
                for (const item of queue) {
                  get()._addStreamingPartDirect(item.messageId, item.part, item.role);
                }
              }, BATCH_INTERVAL);
            }
            return;
          }

          get()._addStreamingPartDirect(messageId, part, role);
        },

        // Internal: direct streaming part processing
        _addStreamingPartDirect: (messageId: string, part: Part, role?: string) => {
          const state = get();
          if (ignoredMessageIds.has(messageId)) return;

          // Zombie detection
          if (state.streamStartTime) {
            const elapsed = Date.now() - state.streamStartTime;
            if (elapsed > ZOMBIE_TIMEOUT) {
              get().completeStreamingMessage(messageId);
              return;
            }
          }

          const existingMessage = state.messages.find((m) => m.info.id === messageId);
          const actualRole = (() => {
            if (role === 'user') return 'user';
            if (existingMessage?.info.role === 'user') return 'user';
            return role || existingMessage?.info.role || 'assistant';
          })();

          set((prevState) => {
            const messages = [...prevState.messages];
            const existingIndex = messages.findIndex((m) => m.info.id === messageId);

            if (existingIndex >= 0) {
              const existing = messages[existingIndex];
              const existingParts = [...(existing.parts || [])];
              const lastPart = existingParts.length > 0 ? existingParts[existingParts.length - 1] : undefined;

              // Merge text parts or append
              if (part.type === 'text' && lastPart?.type === 'text' && !part.id) {
                existingParts[existingParts.length - 1] = normalizeStreamingPart(part, lastPart);
              } else if (part.id) {
                const partIndex = existingParts.findIndex((p) => p.id === part.id);
                if (partIndex >= 0) {
                  existingParts[partIndex] = { ...existingParts[partIndex], ...part } as Part;
                } else {
                  existingParts.push(normalizeStreamingPart(part));
                }
              } else {
                existingParts.push(normalizeStreamingPart(part));
              }

              messages[existingIndex] = {
                info: { ...existing.info, streaming: true },
                parts: existingParts,
              };
            } else {
              // Create new message entry
              const userMeta = prevState.pendingUserMessageMeta;
              const info: any = {
                id: messageId,
                role: actualRole,
                streaming: true,
                time: { created: Date.now() / 1000 },
                clientRole: actualRole,
                ...(actualRole === 'user' && userMeta ? {
                  userMessageMarker: true,
                  mode: userMeta.mode,
                  model: userMeta.providerID && userMeta.modelID ? { providerID: userMeta.providerID, modelID: userMeta.modelID } : undefined,
                  variant: userMeta.variant,
                } : {}),
              };
              messages.push({ info, parts: [normalizeStreamingPart(part)] });
            }

            // Update streaming lifecycle
            const nextStreamStates = new Map(prevState.messageStreamStates);
            const existing = nextStreamStates.get(messageId);
            nextStreamStates.set(messageId, {
              phase: 'streaming',
              startedAt: existing?.startedAt ?? Date.now(),
              lastUpdateAt: Date.now(),
            });

            const result: Partial<ChatState> = {
              messages,
              messageStreamStates: nextStreamStates,
              streamingMessageId: messageId,
              activityPhase: 'busy',
            };

            // Clear pending header on first assistant part
            if (actualRole === 'assistant' && prevState.pendingAssistantHeader) {
              result.pendingAssistantHeader = false;
            }
            // Clear pending user meta after user message is created
            if (actualRole === 'user' && prevState.pendingUserMessageMeta) {
              result.pendingUserMessageMeta = null;
            }

            return result;
          });

          // Set up streaming timeout
          lastContentRegistry.set(messageId, Date.now());
          const existingTimeout = timeoutRegistry.get(messageId);
          if (existingTimeout) clearTimeout(existingTimeout);

          timeoutRegistry.set(messageId, setTimeout(() => {
            const lastUpdate = lastContentRegistry.get(messageId) || 0;
            if (Date.now() - lastUpdate >= STREAMING_TIMEOUT) {
              get().forceCompleteMessage(messageId, "timeout");
            }
            timeoutRegistry.delete(messageId);
            lastContentRegistry.delete(messageId);
          }, STREAMING_TIMEOUT));
        },

        completeStreamingMessage: (messageId: string) => {
          const timeout = timeoutRegistry.get(messageId);
          if (timeout) {
            clearTimeout(timeout);
            timeoutRegistry.delete(messageId);
            lastContentRegistry.delete(messageId);
          }
          clearLifecycleCompletionTimer(messageId);

          set((state) => {
            const nextStates = new Map(state.messageStreamStates);
            nextStates.delete(messageId);

            // Check if any other messages are still streaming
            const stillStreaming = nextStates.size > 0;

            const updatedMessages: MessageEntry[] = state.messages.map((m) => {
              if (m.info.id !== messageId) return m;
              return {
                info: { ...m.info, streaming: false, finish: (m.info as any).finish || 'stop' } as Message & Record<string, unknown>,
                parts: m.parts,
              };
            });

            const result: Partial<ChatState> = {
              messageStreamStates: nextStates,
              messages: updatedMessages,
              streamingMessageId: stillStreaming ? state.streamingMessageId : null,
              isStreaming: stillStreaming,
              activityPhase: stillStreaming ? 'busy' : 'cooldown',
            };
            if (!stillStreaming) {
              result.streamStartTime = undefined;
            }
            return result;
          });

          // Transition from cooldown to idle after a delay
          if (get().activityPhase === 'cooldown') {
            setTimeout(() => {
              if (get().activityPhase === 'cooldown') {
                set({ activityPhase: 'idle' });
              }
            }, 2000);
          }
        },

        forceCompleteMessage: (messageId: string, source: "timeout" | "cooldown" = "timeout") => {
          get().completeStreamingMessage(messageId);
        },

        markMessageStreamSettled: (messageId: string) => {
          set((state) => {
            if (!state.messageStreamStates.has(messageId)) return state;
            const nextStates = new Map(state.messageStreamStates);
            const entry = nextStates.get(messageId);
            if (entry) {
              nextStates.set(messageId, { ...entry, phase: 'completed', completedAt: Date.now() });
            }
            return { messageStreamStates: nextStates };
          });
        },

        updateMessageInfo: (messageId: string, messageInfo: Record<string, unknown>) => {
          set((state) => {
            const idx = state.messages.findIndex((m) => m.info.id === messageId);
            if (idx < 0) return state;
            const messages = [...state.messages];
            messages[idx] = {
              info: { ...messages[idx].info, ...messageInfo },
              parts: messages[idx].parts,
            };
            return { messages };
          });
        },

        // ─── Permissions ────────────────────────────────────────────────────

        addPermission: (permission: PermissionRequest) => {
          const { currentSessionId } = get();
          if (!currentSessionId || permission.sessionID !== currentSessionId) return;

          // Check for duplicates
          if (get().permissions.some((p) => p.id === permission.id)) return;

          // Check for auto-approve
          const agentName = get().currentAgentContext || get().agentSelection || undefined;
          const defaultMode = getAgentDefaultEditPermission(agentName);
          const effectiveMode = get().getAgentEditMode(agentName, defaultMode);
          const permissionType = permission.permission?.toLowerCase?.() ?? null;

          const shouldAutoApprove = effectiveMode === 'full'
            || (effectiveMode === 'allow' && isEditPermissionType(permissionType));

          if (shouldAutoApprove) {
            get().respondToPermission(permission.id, 'once').catch(() => { });
            return;
          }

          set((state) => ({
            permissions: [...state.permissions, permission],
          }));
        },

        respondToPermission: async (requestId: string, response: PermissionResponse) => {
          const { currentDirectory } = get();

          const operation = () => opencodeClient.replyToPermission(requestId, response);
          if (currentDirectory) {
            await opencodeClient.withDirectory(currentDirectory, operation);
          } else {
            await operation();
          }

          if (response === 'reject') {
            await get().abortCurrentOperation();
          }

          set((state) => ({
            permissions: state.permissions.filter((p) => p.id !== requestId),
          }));
        },

        // ─── Questions ──────────────────────────────────────────────────────

        addQuestion: (question: QuestionRequest) => {
          const { currentSessionId } = get();
          if (!currentSessionId || question.sessionID !== currentSessionId) return;
          if (get().questions.some((q) => q.id === question.id)) return;

          set((state) => ({
            questions: [...state.questions, question],
          }));
        },

        dismissQuestion: (requestId: string) => {
          set((state) => ({
            questions: state.questions.filter((q) => q.id !== requestId),
          }));
        },

        respondToQuestion: async (requestId: string, answers: string[] | string[][]) => {
          const { currentDirectory } = get();
          const operation = () => opencodeClient.replyToQuestion(requestId, answers);
          if (currentDirectory) {
            await opencodeClient.withDirectory(currentDirectory, operation);
          } else {
            await operation();
          }
          get().dismissQuestion(requestId);
        },

        rejectQuestion: async (requestId: string) => {
          const { currentDirectory } = get();
          const operation = () => opencodeClient.rejectQuestion(requestId);
          if (currentDirectory) {
            await opencodeClient.withDirectory(currentDirectory, operation);
          } else {
            await operation();
          }
          get().dismissQuestion(requestId);
        },

        // ─── Context & Model ────────────────────────────────────────────────

        saveModelSelection: (providerId: string, modelId: string) => {
          set({ modelSelection: { providerId, modelId } });
        },

        saveAgentSelection: (agentName: string) => {
          set({ agentSelection: agentName });
        },

        saveAgentModelSelection: (agentName: string, providerId: string, modelId: string) => {
          set((state) => ({
            agentModelSelections: { ...state.agentModelSelections, [agentName]: { providerId, modelId } },
          }));
        },

        getAgentModelSelection: (agentName: string) => {
          return get().agentModelSelections[agentName] || null;
        },

        saveAgentModelVariantSelection: (agentName: string, providerId: string, modelId: string, variant: string | undefined) => {
          set((state) => {
            const modelKey = `${providerId}/${modelId}`;
            const agentMap = state.agentModelVariantSelections[agentName] || {};
            if (variant === undefined) {
              const { [modelKey]: _, ...rest } = agentMap;
              if (Object.keys(rest).length === 0) {
                const { [agentName]: __, ...outer } = state.agentModelVariantSelections;
                return { agentModelVariantSelections: outer };
              }
              return { agentModelVariantSelections: { ...state.agentModelVariantSelections, [agentName]: rest } };
            }
            return {
              agentModelVariantSelections: {
                ...state.agentModelVariantSelections,
                [agentName]: { ...agentMap, [modelKey]: variant },
              },
            };
          });
        },

        getAgentModelVariantSelection: (agentName: string, providerId: string, modelId: string) => {
          const agentMap = get().agentModelVariantSelections[agentName];
          if (!agentMap) return undefined;
          return agentMap[`${providerId}/${modelId}`];
        },

        updateContextUsage: (contextLimit: number, outputLimit: number) => {
          const { messages } = get();
          const assistantMessages = messages.filter((m) => m.info.role === 'assistant');
          if (assistantMessages.length === 0) {
            set({ contextUsage: null });
            return;
          }

          const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
          const totalTokens = extractTokensFromMessage(lastAssistantMessage as any);
          if (totalTokens === 0) return;

          const usage = calculateContextUsage(totalTokens, contextLimit, outputLimit);
          const result: ContextUsage = {
            totalTokens,
            percentage: usage.percentage,
            contextLimit: usage.contextLimit,
            outputLimit: usage.outputLimit,
            normalizedOutput: usage.normalizedOutput,
            thresholdLimit: usage.thresholdLimit,
            lastMessageId: lastAssistantMessage.info.id,
          };
          set({ contextUsage: result });
        },

        setCurrentAgentContext: (agentName: string | undefined) => {
          set({ currentAgentContext: agentName });
        },

        analyzeAndSaveExternalSessionChoices: async (agents) => {
          const { messages, saveAgentModelSelection, saveAgentModelVariantSelection, currentAgentContext } = get();
          const agentLastChoices: Record<string, { providerId: string; modelId: string; timestamp: number }> = {};

          const allMessages = messages
            .filter((m) => m.info.role === 'assistant' || m.info.role === 'user')
            .sort((a, b) => (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0));
          const assistantMessages = messages
            .filter((m) => m.info.role === 'assistant')
            .sort((a, b) => (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0));

          const extractAgent = (info: any, idx: number): string | null => {
            if (info.mode && typeof info.mode === 'string' && agents.find((a) => a.name === info.mode)) return info.mode;
            if (info.providerID && info.modelID) {
              const match = agents.find((a: any) => a.model?.providerID === info.providerID && a.model?.modelID === info.modelID);
              if (match) return match.name;
            }
            if (currentAgentContext && agents.find((a) => a.name === currentAgentContext)) return currentAgentContext;
            return null;
          };

          let pendingVariant: string | undefined;
          let pendingUserModel: { providerID: string; modelID: string } | undefined;

          for (const message of allMessages) {
            const info = message.info as any;
            if (info.role === 'user') {
              pendingVariant = typeof info.variant === 'string' && info.variant.trim() ? info.variant : undefined;
              pendingUserModel = info.model?.providerID && info.model?.modelID ? { providerID: info.model.providerID, modelID: info.model.modelID } : undefined;
              continue;
            }
            if (info.providerID && info.modelID) {
              const agentName = extractAgent(info, assistantMessages.indexOf(message));
              if (agentName && agents.find((a) => a.name === agentName)) {
                if (pendingVariant && pendingUserModel && pendingUserModel.providerID === info.providerID && pendingUserModel.modelID === info.modelID) {
                  saveAgentModelVariantSelection(agentName, info.providerID, info.modelID, pendingVariant);
                }
                const choice = { providerId: info.providerID, modelId: info.modelID, timestamp: info.time?.created ?? 0 };
                const existing = agentLastChoices[agentName];
                if (!existing || choice.timestamp > existing.timestamp) agentLastChoices[agentName] = choice;
              }
            }
            pendingVariant = undefined;
            pendingUserModel = undefined;
          }

          for (const [agentName, choice] of Object.entries(agentLastChoices)) {
            saveAgentModelSelection(agentName, choice.providerId, choice.modelId);
          }
          return agentLastChoices;
        },

        // ─── Edit Permission Modes ─────────────────────────────────────────

        getAgentEditMode: (agentName: string | undefined, defaultMode: EditPermissionMode = getAgentDefaultEditPermission(agentName)) => {
          if (!agentName) return defaultMode;
          return get().agentEditModes[agentName] ?? defaultMode;
        },

        setAgentEditMode: (agentName: string | undefined, mode: EditPermissionMode, defaultMode: EditPermissionMode = getAgentDefaultEditPermission(agentName)) => {
          if (!agentName) return;
          const normalizedDefault = defaultMode ?? 'ask';
          if (normalizedDefault === 'deny' || mode === 'deny') return;
          if (!EDIT_PERMISSION_SEQUENCE.includes(mode)) return;

          set((state) => {
            if (mode === normalizedDefault) {
              const { [agentName]: _, ...rest } = state.agentEditModes;
              return { agentEditModes: rest };
            }
            return { agentEditModes: { ...state.agentEditModes, [agentName]: mode } };
          });
        },

        toggleAgentEditMode: (agentName: string | undefined, defaultMode: EditPermissionMode = getAgentDefaultEditPermission(agentName)) => {
          if (!agentName) return;
          const normalizedDefault = defaultMode ?? 'ask';
          if (normalizedDefault === 'deny') return;

          const currentMode = get().getAgentEditMode(agentName, normalizedDefault);
          const currentIndex = EDIT_PERMISSION_SEQUENCE.indexOf(currentMode);
          const fallbackIndex = EDIT_PERMISSION_SEQUENCE.indexOf(normalizedDefault);
          const baseIndex = currentIndex >= 0 ? currentIndex : (fallbackIndex >= 0 ? fallbackIndex : 0);
          const nextIndex = (baseIndex + 1) % EDIT_PERMISSION_SEQUENCE.length;
          get().setAgentEditMode(agentName, EDIT_PERMISSION_SEQUENCE[nextIndex], normalizedDefault);
        },

        // ─── Session Metadata ───────────────────────────────────────────────

        updateSessionTitle: async (title: string) => {
          const { currentSessionId, currentDirectory } = get();
          if (!currentSessionId) return;
          try {
            await opencodeClient.withDirectory(currentDirectory ?? undefined, () =>
              opencodeClient.updateSession(currentSessionId!, title)
            );
            set({ sessionTitle: title });
          } catch (error) {
            console.warn("Failed to update session title:", error);
          }
        },

        updateSession: (session: Session) => {
          set((state) => {
            if (state.currentSessionId !== session.id) return state;
            return {
              session,
              sessionTitle: session.title || state.sessionTitle,
            };
          });
        },

        updateCompaction: (compactingTimestamp: number | null | undefined) => {
          set({ compactionUntil: compactingTimestamp ?? null });
        },

        acknowledgeAbort: () => {
          set({ sessionAbortTimestamp: null });
        },

        getLastMessageModel: () => {
          const { messages } = get();
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.info.role === 'assistant') {
              const info = msg.info as any;
              if (info.providerID && info.modelID) {
                return { providerID: info.providerID, modelID: info.modelID };
              }
            }
          }
          return null;
        },

        // ─── Pending Input ──────────────────────────────────────────────────

        setPendingInputText: (text: string | null) => {
          set({ pendingInputText: text });
        },

        consumePendingInputText: () => {
          const text = get().pendingInputText;
          if (text !== null) {
            set({ pendingInputText: null });
          }
          return text;
        },

        // ─── Abort Prompt ───────────────────────────────────────────────────

        armAbortPrompt: (durationMs = 3000) => {
          const { currentSessionId } = get();
          if (!currentSessionId) return null;
          const expiresAt = Date.now() + durationMs;
          set({ abortPromptExpiresAt: expiresAt });
          return expiresAt;
        },

        clearAbortPrompt: () => {
          set({ abortPromptExpiresAt: null });
        },

        // ─── Revert / Fork ──────────────────────────────────────────────────

        revertToMessage: async (messageId: string) => {
          const { currentSessionId, messages } = get();
          if (!currentSessionId) return;

          // Extract text from target message (if user message)
          const targetMessage = messages.find((m) => m.info.id === messageId);
          let messageText = '';
          if (targetMessage && targetMessage.info.role === 'user') {
            const textParts = targetMessage.parts.filter((p) => p.type === 'text');
            messageText = textParts
              .map((p) => {
                const part = p as { text?: string; content?: string };
                return part.text || part.content || '';
              })
              .join('\n')
              .trim();
          }

          // Call revert API
          const updatedSession = await opencodeClient.revertSession(currentSessionId, messageId);
          get().updateSession(updatedSession);

          // Filter out reverted messages
          const revertMessageId = updatedSession.revert?.messageID;
          if (revertMessageId) {
            const currentMessages = get().messages;
            const revertIndex = currentMessages.findIndex((m) => m.info.id === revertMessageId);
            if (revertIndex !== -1) {
              set({ messages: currentMessages.slice(0, revertIndex) });
            }
          }

          if (messageText) {
            set({ pendingInputText: messageText });
          }
        },

        handleSlashUndo: async () => {
          const { currentSessionId, messages, session } = get();
          if (!currentSessionId) return;

          const userMessages = messages.filter((m) => m.info.role === 'user');
          if (userMessages.length === 0) return;

          const revertToId = session?.revert?.messageID;
          let targetMessage;
          if (revertToId) {
            const revertIndex = userMessages.findIndex((m) => m.info.id === revertToId);
            targetMessage = userMessages[revertIndex + 1];
          } else {
            targetMessage = userMessages[userMessages.length - 1];
          }

          if (!targetMessage) return;

          await get().revertToMessage(targetMessage.info.id);

          const { toast } = await import('sonner');
          const textPart = targetMessage.parts.find((p) => p.type === 'text');
          const preview = typeof textPart === 'object' && textPart && 'text' in textPart
            ? String(textPart.text).slice(0, 50) + (String(textPart.text).length > 50 ? '...' : '')
            : '[No text]';
          toast.success(`Undid to: ${preview}`);
        },

        handleSlashRedo: async () => {
          const { currentSessionId, session } = get();
          if (!currentSessionId) return;

          const revertToId = session?.revert?.messageID;
          if (!revertToId) return;

          const { messages } = get();
          const userMessages = messages.filter((m) => m.info.role === 'user');
          const revertIndex = userMessages.findIndex((m) => m.info.id === revertToId);
          const targetMessage = userMessages[revertIndex - 1];

          if (targetMessage) {
            await get().revertToMessage(targetMessage.info.id);
            const { toast } = await import('sonner');
            const textPart = targetMessage.parts.find((p) => p.type === 'text');
            const preview = typeof textPart === 'object' && textPart && 'text' in textPart
              ? String(textPart.text).slice(0, 50) + (String(textPart.text).length > 50 ? '...' : '')
              : '[No text]';
            toast.success(`Redid to: ${preview}`);
          } else {
            // Full unrevert
            const updatedSession = await opencodeClient.unrevertSession(currentSessionId);
            get().updateSession(updatedSession);
            await get().loadMessages();
            const { toast } = await import('sonner');
            toast.success('Restored all messages');
          }
        },

        forkFromMessage: async (messageId: string) => {
          const { currentSessionId, messages, currentDirectory } = get();
          if (!currentSessionId || !currentDirectory) return;

          const message = messages.find((m) => m.info.id === messageId);
          if (!message) return;

          try {
            const result = await opencodeClient.forkSession(currentSessionId, messageId);
            if (!result || !result.id) {
              const { toast } = await import('sonner');
              toast.error('Failed to fork session');
              return;
            }

            // Extract text content
            let inputText = '';
            for (const part of message.parts) {
              if (part.type === 'text' && !part.synthetic && !part.ignored) {
                const typedPart = part as { text?: string };
                inputText += typedPart.text || '';
              }
            }

            // Load the forked session
            await get().loadSession(currentDirectory);

            if (inputText) {
              set({ pendingInputText: inputText });
            }

            const { toast } = await import('sonner');
            toast.success('Forked session');
          } catch (error) {
            console.error('Failed to fork session:', error);
            const { toast } = await import('sonner');
            toast.error('Failed to fork session');
          }
        },

        // ─── Session Listing & Management ────────────────────────────────────

        loadAllSessions: async () => {
          try {
            const apiClient = opencodeClient.getApiClient();
            const response = await apiClient.session.list(undefined);
            const sessions = Array.isArray(response.data) ? response.data : [];
            set({ allSessions: sessions });
          } catch (error) {
            console.error('Failed to load all sessions:', error);
          }
        },

        deleteSession: async (id: string, options?) => {
          const metadata = get().worktreeMetadata.get(id);
          const sessionDir = get().sessionDirectories.get(id) ?? metadata?.path;

          try {
            if (metadata && options?.archiveWorktree) {
              const { archiveWorktree, getWorktreeStatus } = await import('@/lib/git/worktreeService');
              const status = metadata.status ?? (await getWorktreeStatus(metadata.path).catch(() => undefined));
              await archiveWorktree({
                projectDirectory: metadata.projectDirectory,
                path: metadata.path,
                branch: metadata.branch,
                force: Boolean(status?.isDirty),
                deleteRemote: Boolean(options?.deleteRemoteBranch),
                remote: options?.remoteName,
              });
            }

            const deleteRequest = () => opencodeClient.deleteSession(id);
            const success = sessionDir
              ? await opencodeClient.withDirectory(sessionDir, deleteRequest)
              : await deleteRequest();

            if (success) {
              set((state) => ({
                allSessions: state.allSessions.filter((s) => s.id !== id),
                worktreeMetadata: (() => { const m = new Map(state.worktreeMetadata); m.delete(id); return m; })(),
                sessionDirectories: (() => { const m = new Map(state.sessionDirectories); m.delete(id); return m; })(),
              }));

              // If we deleted the current session, clear it
              if (get().currentSessionId === id) {
                get().clearSession();
              }
            }
            return success;
          } catch (error) {
            console.error('Failed to delete session:', error);
            return false;
          }
        },

        deleteSessions: async (ids: string[], options?) => {
          const uniqueIds = Array.from(new Set(ids));
          const deletedIds: string[] = [];
          const failedIds: string[] = [];
          const archivedPaths = new Set<string>();

          for (const id of uniqueIds) {
            const metadata = get().worktreeMetadata.get(id);
            const sessionDir = get().sessionDirectories.get(id) ?? metadata?.path;

            try {
              if (metadata && options?.archiveWorktree && !archivedPaths.has(metadata.path)) {
                const { archiveWorktree, getWorktreeStatus } = await import('@/lib/git/worktreeService');
                const status = metadata.status ?? (await getWorktreeStatus(metadata.path).catch(() => undefined));
                await archiveWorktree({
                  projectDirectory: metadata.projectDirectory,
                  path: metadata.path,
                  branch: metadata.branch,
                  force: Boolean(status?.isDirty),
                  deleteRemote: Boolean(options?.deleteRemoteBranch),
                  remote: options?.remoteName,
                });
                archivedPaths.add(metadata.path);
              }

              const deleteRequest = () => opencodeClient.deleteSession(id);
              const success = sessionDir
                ? await opencodeClient.withDirectory(sessionDir, deleteRequest)
                : await deleteRequest();

              if (success) {
                deletedIds.push(id);
              } else {
                failedIds.push(id);
              }
            } catch {
              failedIds.push(id);
            }
          }

          if (deletedIds.length > 0) {
            const deletedSet = new Set(deletedIds);
            set((state) => ({
              allSessions: state.allSessions.filter((s) => !deletedSet.has(s.id)),
            }));

            if (get().currentSessionId && deletedSet.has(get().currentSessionId!)) {
              get().clearSession();
            }
          }

          return { deletedIds, failedIds };
        },

        getWorktreeMetadata: (sessionId: string) => {
          return get().worktreeMetadata.get(sessionId);
        },

        setWorktreeMetadata: (sessionId: string, metadata) => {
          set((state) => {
            const newMap = new Map(state.worktreeMetadata);
            newMap.set(sessionId, metadata);
            return { worktreeMetadata: newMap };
          });
        },

        setSessionDirectory: (sessionId: string, directory: string) => {
          set((state) => {
            const newMap = new Map(state.sessionDirectories);
            newMap.set(sessionId, directory);
            return { sessionDirectories: newMap };
          });
        },

        refreshWorktrees: async () => {
          const projects = useProjectsStore.getState().projects;
          if (projects.length === 0) return;

          const nextMap = new Map<string, import("@/types/worktree").WorktreeMetadata[]>();

          for (const project of projects) {
            if (!project.path) continue;
            const normalizedProjectPath = normalizePath(project.path);
            if (!normalizedProjectPath) continue;

            try {
              const worktreeInfos = await listWorktrees(project.path);
              const mapped = worktreeInfos.map((info) =>
                mapWorktreeToMetadata(project.path, info)
              );
              nextMap.set(normalizedProjectPath, mapped);
            } catch {
              // If listing fails (e.g., path doesn't exist), set empty array
              nextMap.set(normalizedProjectPath, []);
            }
          }

          set({ availableWorktreesByProject: nextMap });
        },

        // ─── Cleanup ────────────────────────────────────────────────────────

        cleanupSession: () => {
          // Clear all timers
          timeoutRegistry.forEach((timer) => clearTimeout(timer));
          timeoutRegistry.clear();
          lastContentRegistry.clear();
          lifecycleCompletionTimers.forEach((timer) => clearTimeout(timer));
          lifecycleCompletionTimers.clear();
          if (batchTimer) {
            clearTimeout(batchTimer);
            batchTimer = null;
          }
          batchQueue = [];
          ignoredMessageIds.clear();

          set({
            messages: [],
            streamingMessageId: null,
            messageStreamStates: new Map(),
            isStreaming: false,
            streamStartTime: undefined,
            permissions: [],
            questions: [],
            contextUsage: null,
            activityPhase: 'idle',
            abortController: null,
            pendingAssistantHeader: false,
            pendingUserMessageMeta: null,
            sessionAbortTimestamp: null,
            compactionUntil: null,
            totalAvailableMessages: 0,
            hasMoreAbove: false,
            pendingInputText: null,
            abortPromptExpiresAt: null,
          });
        },
      }),
      {
        name: "chat-store",
        storage: createJSONStorage(() => settingsFileStorage),
        partialize: (state) => ({
          modelSelection: state.modelSelection,
          agentSelection: state.agentSelection,
          agentModelSelections: state.agentModelSelections,
          agentModelVariantSelections: state.agentModelVariantSelections,
          agentEditModes: state.agentEditModes,
          lastUsedProvider: state.lastUsedProvider,
        }),
        merge: (persistedState: any, currentState) => {
          if (!persistedState || typeof persistedState !== 'object') {
            return currentState;
          }

          // Migrate old Map-serialized arrays to Records
          const migrateToRecord = (val: any): Record<string, any> => {
            if (Array.isArray(val)) return Object.fromEntries(val);
            return val && typeof val === 'object' ? val : {};
          };

          const variantRaw = persistedState.agentModelVariantSelections;
          let variants: Record<string, Record<string, string>> = {};
          if (Array.isArray(variantRaw)) {
            for (const [agent, entries] of variantRaw) {
              variants[agent] = Array.isArray(entries) ? Object.fromEntries(entries) : (entries || {});
            }
          } else if (variantRaw && typeof variantRaw === 'object') {
            variants = variantRaw;
          }

          return {
            ...currentState,
            modelSelection: persistedState.modelSelection,
            agentSelection: persistedState.agentSelection,
            agentModelSelections: migrateToRecord(persistedState.agentModelSelections),
            agentModelVariantSelections: variants,
            agentEditModes: migrateToRecord(persistedState.agentEditModes),
            lastUsedProvider: persistedState.lastUsedProvider,
          };
        },
      }
    ),
    { name: "chat-store" }
  )
);

