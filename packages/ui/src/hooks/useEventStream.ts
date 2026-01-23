import React from 'react';
import { opencodeClient, type RoutedOpencodeEvent } from '@/lib/opencode/client';
import { useChatStore } from '@/stores/useChatStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { useUIStore, type EventStreamStatus } from '@/stores/useUIStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import type { Part, Session, Message } from '@opencode-ai/sdk/v2';
import type { PermissionRequest } from '@/types/permission';
import type { QuestionRequest } from '@/types/question';
import { streamDebugEnabled } from '@/stores/utils/streamDebug';
import { handleTodoUpdatedEvent } from '@/stores/useTodoStore';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { isWebRuntime } from '@/lib/desktop';

interface EventData {
  type: string;
  properties?: Record<string, unknown>;
}

type MessageTracker = (messageId: string, event?: string, extraData?: Record<string, unknown>) => void;

declare global {
  interface Window {
    __messageTracker?: MessageTracker;
  }
}

const ENABLE_EMPTY_RESPONSE_DETECTION = false;
const TEXT_SHRINK_TOLERANCE = 50;
const RESYNC_DEBOUNCE_MS = 750;

const computeTextLength = (parts: Part[] | undefined | null): number => {
  if (!parts || !Array.isArray(parts)) return 0;
  let length = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part?.type === 'text') {
      const text = (part as { text?: string; content?: string }).text ?? (part as { text?: string; content?: string }).content;
      if (typeof text === 'string') length += text.length;
    }
  }
  return length;
};

const formatModelID = (raw: string): string => {
  if (!raw) return 'Assistant';
  const tokens: string[] = raw.split(/[-_]/);
  const result: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const current = tokens[i];
    if (/^\d+$/.test(current)) {
      if (i + 1 < tokens.length && /^\d+$/.test(tokens[i + 1])) {
        result.push(`${current}.${tokens[i + 1]}`);
        i += 2;
        continue;
      }
    }
    result.push(current);
    i += 1;
  }
  return result.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
};

export const useEventStream = () => {
  const {
    addStreamingPart,
    completeStreamingMessage,
    updateMessageInfo,
    updateCompaction,
    addPermission,
    addQuestion,
    dismissQuestion,
    updateSession,
    loadMessages,
    currentSessionId,
    currentDirectory,
  } = useChatStore();

  const { checkConnection } = useConfigStore();
  const nativeNotificationsEnabled = useUIStore((state) => state.nativeNotificationsEnabled);
  const notificationMode = useUIStore((state) => state.notificationMode);
  const fallbackDirectory = useDirectoryStore((state) => state.currentDirectory);

  const effectiveDirectory = React.useMemo(() => {
    if (currentDirectory && currentDirectory.length > 0) return currentDirectory;
    if (typeof fallbackDirectory === 'string' && fallbackDirectory.trim().length > 0) {
      return fallbackDirectory.trim();
    }
    return undefined;
  }, [currentDirectory, fallbackDirectory]);

  // ─── Bootstrap pending permissions & questions on mount ─────────────────────

  React.useEffect(() => {
    let cancelled = false;

    const bootstrapPending = async () => {
      try {
        const [permissions, questions] = await Promise.allSettled([
          opencodeClient.listPendingPermissions(),
          effectiveDirectory
            ? opencodeClient.withDirectory(effectiveDirectory, () =>
                opencodeClient.listPendingQuestions({ directories: [effectiveDirectory] })
              )
            : opencodeClient.listPendingQuestions({}),
        ]);

        if (cancelled) return;

        if (permissions.status === 'fulfilled' && permissions.value.length > 0) {
          for (const request of permissions.value) {
            addPermission(request as unknown as PermissionRequest);
          }
        }
        if (questions.status === 'fulfilled' && questions.value.length > 0) {
          for (const request of questions.value) {
            addQuestion(request as unknown as QuestionRequest);
          }
        }
      } catch {
        // ignored
      }
    };

    void bootstrapPending();
    return () => { cancelled = true; };
  }, [addPermission, addQuestion, effectiveDirectory]);

  // ─── Status publishing ──────────────────────────────────────────────────────

  const setEventStreamStatus = useUIStore((state) => state.setEventStreamStatus);
  const lastStatusRef = React.useRef<{ status: EventStreamStatus; hint: string | null } | null>(null);

  const publishStatus = React.useCallback(
    (status: EventStreamStatus, hint?: string | null) => {
      const normalizedHint = hint ?? null;
      const last = lastStatusRef.current;
      if (last && last.status === status && last.hint === normalizedHint) return;
      lastStatusRef.current = { status, hint: normalizedHint };
      if (streamDebugEnabled()) {
        console.info(`[useEventStream] SSE ${status}${normalizedHint ? `: ${normalizedHint}` : ''}`);
      }
      setEventStreamStatus(status, normalizedHint);
    },
    [setEventStreamStatus]
  );

  // ─── Refs ───────────────────────────────────────────────────────────────────

  const unsubscribeRef = React.useRef<(() => void) | null>(null);
  const reconnectTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = React.useRef(0);
  const emptyResponseToastShownRef = React.useRef<Set<string>>(new Set());
  const isCleaningUpRef = React.useRef(false);
  const resyncInFlightRef = React.useRef<Promise<void> | null>(null);
  const lastResyncAtRef = React.useRef(0);
  const notifiedMessagesRef = React.useRef<Set<string>>(new Set());
  const notifiedQuestionsRef = React.useRef<Set<string>>(new Set());
  const lastEventTimestampRef = React.useRef<number>(Date.now());
  const isDesktopRuntimeRef = React.useRef<boolean>(false);
  const currentSessionIdRef = React.useRef<string | null>(currentSessionId);
  const cooldownTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const pendingResumeRef = React.useRef(false);
  const pauseTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const staleCheckIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const apis = (window as typeof window & { __OPENCHAMBER_RUNTIME_APIS__?: { runtime?: { isDesktop?: boolean } } }).__OPENCHAMBER_RUNTIME_APIS__;
      if (apis?.runtime?.isDesktop) {
        isDesktopRuntimeRef.current = true;
      }
    }
  }, []);

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const resolveVisibilityState = React.useCallback((): 'visible' | 'hidden' => {
    if (typeof document === 'undefined') return 'visible';
    const state = document.visibilityState;
    return state === 'hidden' && document.hasFocus() ? 'visible' : state;
  }, []);

  const visibilityStateRef = React.useRef<'visible' | 'hidden'>(resolveVisibilityState());
  const onlineStatusRef = React.useRef<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);

  const resyncMessages = React.useCallback(
    (_reason: string, limit?: number) => {
      if (!currentSessionIdRef.current) return Promise.resolve();
      const now = Date.now();
      if (resyncInFlightRef.current) return resyncInFlightRef.current;
      if (now - lastResyncAtRef.current < RESYNC_DEBOUNCE_MS) return Promise.resolve();

      const task = loadMessages(limit)
        .catch((error) => {
          console.warn(`[useEventStream] Failed to resync messages (${_reason}):`, error);
        })
        .finally(() => {
          resyncInFlightRef.current = null;
          lastResyncAtRef.current = Date.now();
        });
      resyncInFlightRef.current = task;
      return task;
    },
    [loadMessages]
  );

  const bootstrapState = React.useCallback(
    async (reason: string) => {
      if (streamDebugEnabled()) {
        console.info('[useEventStream] Bootstrapping state:', reason);
      }
      try {
        if (currentSessionIdRef.current) {
          await resyncMessages(reason, Infinity);
        }
      } catch (error) {
        console.warn('[useEventStream] Bootstrap failed:', reason, error);
      }
    },
    [resyncMessages]
  );

  const maybeBootstrapIfStale = React.useCallback(
    (reason: string) => {
      const now = Date.now();
      if (now - lastEventTimestampRef.current > 25000) {
        void bootstrapState(reason);
        lastEventTimestampRef.current = now;
      }
    },
    [bootstrapState]
  );

  const updateActivityPhase = React.useCallback((phase: 'idle' | 'busy' | 'cooldown') => {
    const current = useChatStore.getState().activityPhase;
    if (current === phase) return;

    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }

    useChatStore.setState({ activityPhase: phase });

    if (phase === 'cooldown') {
      cooldownTimerRef.current = setTimeout(() => {
        cooldownTimerRef.current = null;
        if (useChatStore.getState().activityPhase === 'cooldown') {
          useChatStore.setState({ activityPhase: 'idle' });
        }
      }, 2000);
    }
  }, []);

  const refreshSessionActivityStatus = React.useCallback(async () => {
    const sessionId = currentSessionIdRef.current;
    if (!sessionId) return;

    try {
      const statusMap = await opencodeClient.getGlobalSessionStatus();
      if (statusMap && typeof statusMap === 'object') {
        const entry = statusMap[sessionId] as { type?: string } | undefined;
        if (entry) {
          const phase: 'idle' | 'busy' =
            entry.type === 'busy' || entry.type === 'retry' ? 'busy' : 'idle';
          updateActivityPhase(phase);
        } else {
          // If not listed, it's idle
          const current = useChatStore.getState().activityPhase;
          if (current === 'busy') {
            updateActivityPhase('idle');
          }
        }
      }
    } catch {
      // ignored
    }
  }, [updateActivityPhase]);

  const requestSessionMetadataRefresh = React.useCallback(() => {
    const sessionId = currentSessionIdRef.current;
    const directory = useChatStore.getState().currentDirectory;
    if (!sessionId) return;

    setTimeout(async () => {
      try {
        const session = directory
          ? await opencodeClient.withDirectory(directory, () => opencodeClient.getSession(sessionId))
          : await opencodeClient.getSession(sessionId);

        if (session) {
          updateSession(session);
        }
      } catch (error) {
        console.warn('Failed to refresh session metadata:', error);
      }
    }, 100);
  }, [updateSession]);

  const trackMessage = React.useCallback((messageId: string, event?: string, extraData?: Record<string, unknown>) => {
    if (streamDebugEnabled()) {
      console.debug(`[MessageTracker] ${messageId}: ${event}`, extraData);
    }
  }, []);

  // ─── Event Handler ──────────────────────────────────────────────────────────

  const handleEvent = React.useCallback((event: EventData) => {
    lastEventTimestampRef.current = Date.now();

    if (streamDebugEnabled()) {
      console.debug('[useEventStream] Received event:', event.type, event.properties);
    }

    const props = event.properties || {};
    const currentSession = currentSessionIdRef.current;

    // Resolve session ID from event
    const resolveSessionId = (): string | null => {
      if (typeof props.sessionID === 'string' && props.sessionID.length > 0) return props.sessionID as string;
      const message = typeof props.message === 'object' && props.message !== null ? props.message as Record<string, unknown> : null;
      if (message && typeof message.sessionID === 'string') return message.sessionID as string;
      const info = typeof props.info === 'object' && props.info !== null ? props.info as Record<string, unknown> : null;
      if (info && typeof info.sessionID === 'string') return info.sessionID as string;
      return null;
    };

    switch (event.type) {
      case 'message.part.updated': {
        const messageId = typeof props.messageID === 'string' ? props.messageID : null;
        const part = typeof props.part === 'object' && props.part !== null ? props.part as Part : null;

        if (!messageId || !part) break;

        const sessionId = resolveSessionId();
        if (sessionId && currentSession && sessionId !== currentSession) break;

        // Determine role from context
        const message = typeof props.message === 'object' && props.message !== null
          ? props.message as Record<string, unknown>
          : null;
        const role = message && typeof message.role === 'string' ? message.role : undefined;

        // Mark as busy on first streaming part
        if (useChatStore.getState().activityPhase !== 'busy') {
          updateActivityPhase('busy');
        }

        addStreamingPart(messageId, part, role);

        // Track session metadata from message
        if (message) {
          const messageExt = message as Record<string, unknown>;
          if (messageExt.providerID || messageExt.modelID) {
            const providerID = typeof messageExt.providerID === 'string' ? messageExt.providerID : undefined;
            const modelID = typeof messageExt.modelID === 'string' ? messageExt.modelID : undefined;
            if (providerID && modelID) {
              useChatStore.setState({ lastUsedProvider: { providerID, modelID } });
            }
          }
        }
        break;
      }

      case 'message.updated': {
        const message = typeof props.info === 'object' && props.info !== null
          ? props.info as Message & Record<string, unknown>
          : typeof props.message === 'object' && props.message !== null
            ? props.message as Message & Record<string, unknown>
            : null;

        if (!message) break;

        const messageId = typeof message.id === 'string' ? message.id : null;
        if (!messageId) break;

        const sessionId = typeof message.sessionID === 'string' ? message.sessionID as string
          : typeof props.sessionID === 'string' ? props.sessionID as string
          : null;
        if (sessionId && currentSession && sessionId !== currentSession) break;

        const role = typeof message.role === 'string' ? message.role : null;
        const finish = typeof (message as Record<string, unknown>).finish === 'string'
          ? (message as Record<string, unknown>).finish as string
          : null;

        // Update message info in store
        updateMessageInfo(messageId, message as Record<string, unknown>);

        // If user message, just track it
        if (role === 'user') {
          trackMessage(messageId, 'user_message');
          break;
        }

        // For assistant messages, handle completion
        if (role === 'assistant' && finish) {
          // Check for text shrink (streaming glitch detection)
          const storeMessages = useChatStore.getState().messages;
          const existingMsg = storeMessages.find(m => m.info.id === messageId);

          if (existingMsg) {
            const existingLength = computeTextLength(existingMsg.parts);
            const incomingParts = Array.isArray(message.parts) ? message.parts as Part[] : [];
            const incomingLength = computeTextLength(incomingParts);

            if (existingLength > 0 && incomingLength > 0 &&
                incomingLength < existingLength - TEXT_SHRINK_TOLERANCE) {
              if (streamDebugEnabled()) {
                console.warn('[useEventStream] Text shrink detected, keeping existing parts');
              }
              break;
            }
          }

          // Empty response detection
          if (ENABLE_EMPTY_RESPONSE_DETECTION && finish === 'stop') {
            const msgParts = existingMsg?.parts || [];
            const incomingParts = Array.isArray(message.parts) ? message.parts as Part[] : [];
            const combinedParts = [...msgParts];
            for (const part of incomingParts) {
              if (!part) continue;
              const alreadyPresent = combinedParts.some((existing) =>
                existing.id === part.id && existing.type === part.type
              );
              if (!alreadyPresent) combinedParts.push(part);
            }

            const hasMeaningfulContent = combinedParts.some(p => {
              if (p.type === 'text') {
                const text = (p as { text?: string }).text;
                return typeof text === 'string' && text.trim().length > 0;
              }
              return p.type === 'tool' || p.type === 'reasoning' || p.type === 'file';
            });

            if (!hasMeaningfulContent && !emptyResponseToastShownRef.current.has(messageId)) {
              emptyResponseToastShownRef.current.add(messageId);
              import('sonner').then(({ toast }) => {
                toast.info('Assistant response was empty', {
                  description: 'Try sending your message again or rephrase it.',
                  duration: 5000,
                });
              });
            }
          }

          completeStreamingMessage(messageId);

          // Native notification on completion
          if (finish === 'stop' && isWebRuntime() && nativeNotificationsEnabled) {
            const shouldNotify = notificationMode === 'always' || visibilityStateRef.current === 'hidden';
            if (shouldNotify && !notifiedMessagesRef.current.has(messageId)) {
              notifiedMessagesRef.current.add(messageId);
              const runtimeAPIs = getRegisteredRuntimeAPIs();
              if (runtimeAPIs?.notifications) {
                const messageExt = message as Record<string, unknown>;
                const rawMode = (messageExt.mode as string) || 'agent';
                const rawModel = (messageExt.modelID as string) || 'assistant';
                void runtimeAPIs.notifications.notifyAgentCompletion({
                  title: `${rawMode.charAt(0).toUpperCase() + rawMode.slice(1)} agent is ready`,
                  body: `${formatModelID(rawModel)} completed the task`,
                  tag: messageId,
                });
              }
            }
          }

          // Trigger cooldown for web/vscode on finish=stop
          if (!isDesktopRuntimeRef.current && finish === 'stop') {
            if (useChatStore.getState().activityPhase === 'busy') {
              updateActivityPhase('cooldown');
            }
          }

          // Refresh session metadata
          requestSessionMetadataRefresh();

          // Handle compaction summary
          const summaryInfo = message as Record<string, unknown>;
          if (summaryInfo.summary) {
            updateCompaction(null);
          }
        }
        break;
      }

      case 'session.created':
      case 'session.updated': {
        const candidate = (typeof props.info === 'object' && props.info !== null) ? props.info as Record<string, unknown> :
                         (typeof props.sessionInfo === 'object' && props.sessionInfo !== null) ? props.sessionInfo as Record<string, unknown> :
                         (typeof props.session === 'object' && props.session !== null) ? props.session as Record<string, unknown> : props;

        const sessionId = (typeof candidate.id === 'string' && candidate.id.length > 0) ? candidate.id :
                         (typeof candidate.sessionID === 'string' && candidate.sessionID.length > 0) ? candidate.sessionID :
                         (typeof props.sessionID === 'string' && props.sessionID.length > 0) ? props.sessionID :
                         (typeof props.id === 'string' && props.id.length > 0) ? props.id : undefined;

        if (!sessionId || sessionId !== currentSession) break;

        // Update compaction
        const timeSource = (typeof candidate.time === 'object' && candidate.time !== null) ? candidate.time as Record<string, unknown> : null;
        const compactingTimestamp = timeSource && typeof timeSource.compacting === 'number' ? timeSource.compacting as number : null;
        updateCompaction(compactingTimestamp);

        updateSession(candidate as unknown as Session);
        break;
      }

      case 'session.deleted': {
        const sessionId = typeof props.sessionID === 'string' ? props.sessionID
          : typeof props.id === 'string' ? props.id : null;

        if (sessionId && sessionId === currentSession) {
          // Our session was deleted externally — clear state
          useChatStore.getState().clearSession();
        }
        break;
      }

      case 'session.abort': {
        const messageId = typeof props.messageID === 'string' && props.messageID.length > 0
          ? props.messageID : null;
        const sessionId = typeof props.sessionID === 'string' && props.sessionID.length > 0
          ? props.sessionID : null;

        if (sessionId && sessionId !== currentSession) break;

        if (messageId) {
          completeStreamingMessage(messageId);
        }
        break;
      }

      case 'permission.asked': {
        if (!('sessionID' in props) || typeof props.sessionID !== 'string') break;

        const request = props as unknown as PermissionRequest;
        addPermission(request);

        // Native notification
        if (isWebRuntime() && nativeNotificationsEnabled) {
          const shouldNotify = notificationMode === 'always' || visibilityStateRef.current === 'hidden';
          if (shouldNotify) {
            const runtimeAPIs = getRegisteredRuntimeAPIs();
            if (runtimeAPIs?.notifications) {
              void runtimeAPIs.notifications.notifyAgentCompletion({
                title: 'Permission required',
                body: 'Agent is waiting for approval',
                tag: `permission-${request.sessionID}:${request.id}`,
              });
            }
          }
        }
        break;
      }

      case 'permission.replied':
        break;

      case 'question.asked': {
        if (!('sessionID' in props) || typeof props.sessionID !== 'string') break;

        const request = props as unknown as QuestionRequest;
        addQuestion(request);

        // Native notification
        if (isWebRuntime() && nativeNotificationsEnabled) {
          const shouldNotify = notificationMode === 'always' || visibilityStateRef.current === 'hidden';
          if (shouldNotify) {
            const toastKey = `${request.sessionID}:${request.id}`;
            if (!notifiedQuestionsRef.current.has(toastKey)) {
              notifiedQuestionsRef.current.add(toastKey);
              const runtimeAPIs = getRegisteredRuntimeAPIs();
              if (runtimeAPIs?.notifications) {
                void runtimeAPIs.notifications.notifyAgentCompletion({
                  title: 'Input needed',
                  body: 'Agent is waiting for your response',
                  tag: toastKey,
                });
              }
            }
          }
        }
        break;
      }

      case 'question.replied': {
        const requestId = typeof props.requestID === 'string' ? props.requestID : null;
        if (requestId) {
          dismissQuestion(requestId);
        }
        break;
      }

      case 'todo.updated': {
        const sessionId = typeof props.sessionID === 'string' ? props.sessionID : null;
        const todos = Array.isArray(props.todos) ? props.todos : null;
        if (sessionId && todos) {
          handleTodoUpdatedEvent(
            sessionId,
            todos as Array<{ id: string; content: string; status: string; priority: string }>
          );
        }
        break;
      }
    }
  }, [
    nativeNotificationsEnabled,
    notificationMode,
    addStreamingPart,
    completeStreamingMessage,
    updateMessageInfo,
    addPermission,
    addQuestion,
    dismissQuestion,
    updateCompaction,
    updateSession,
    updateActivityPhase,
    requestSessionMetadataRefresh,
    trackMessage,
  ]);

  // ─── Connection Management ──────────────────────────────────────────────────

  const shouldHoldConnection = React.useCallback(() => {
    const currentVisibility = resolveVisibilityState();
    visibilityStateRef.current = currentVisibility;
    return currentVisibility === 'visible' && onlineStatusRef.current;
  }, [resolveVisibilityState]);

  const stopStream = React.useCallback(() => {
    if (isCleaningUpRef.current) return;
    isCleaningUpRef.current = true;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (unsubscribeRef.current) {
      const unsubscribe = unsubscribeRef.current;
      unsubscribeRef.current = null;
      try {
        unsubscribe();
      } catch (error) {
        console.warn('[useEventStream] Error during unsubscribe:', error);
      }
    }

    isCleaningUpRef.current = false;
  }, []);

  const startStream = React.useCallback(async (options?: { resetAttempts?: boolean }) => {
    if (!shouldHoldConnection()) {
      pendingResumeRef.current = true;
      if (!onlineStatusRef.current) {
        publishStatus('offline', 'Waiting for network');
      } else {
        publishStatus('paused', 'Paused while hidden');
      }
      return;
    }

    if (options?.resetAttempts) {
      reconnectAttemptsRef.current = 0;
    }

    stopStream();
    lastEventTimestampRef.current = Date.now();
    publishStatus('connecting', null);

    if (streamDebugEnabled()) {
      console.info('[useEventStream] Starting event stream...');
    }

    const onError = (error: unknown) => {
      console.warn('Event stream error:', error);
    };

    const onOpen = () => {
      const shouldRefresh = pendingResumeRef.current;
      reconnectAttemptsRef.current = 0;
      pendingResumeRef.current = false;
      lastEventTimestampRef.current = Date.now();
      publishStatus('connected', null);
      checkConnection();
      void refreshSessionActivityStatus();

      if (shouldRefresh) {
        void bootstrapState('sse_reconnected');
      } else if (currentSessionIdRef.current) {
        setTimeout(() => {
          resyncMessages('sse_reconnected', Infinity)
            .then(() => requestSessionMetadataRefresh())
            .catch((error) => {
              console.warn('[useEventStream] Failed to resync messages after reconnect:', error);
            });
        }, 0);
      }
    };

    if (isCleaningUpRef.current) return;

    try {
      const sdkUnsub = opencodeClient.subscribeToGlobalEvents(
        (event: RoutedOpencodeEvent) => {
          const payload = event.payload as unknown as EventData;
          const payloadRecord = event.payload as unknown as Record<string, unknown>;
          const baseProperties =
            typeof payloadRecord.properties === 'object' && payloadRecord.properties !== null
              ? (payloadRecord.properties as Record<string, unknown>)
              : {};

          const properties =
            event.directory && event.directory !== 'global'
              ? { ...baseProperties, directory: event.directory }
              : baseProperties;

          handleEvent({
            type: typeof (payload as { type?: unknown }).type === 'string' ? (payload as { type: string }).type : '',
            properties,
          });
        },
        onError,
        onOpen,
      );

      if (!isCleaningUpRef.current) {
        unsubscribeRef.current = () => {
          try { sdkUnsub(); } catch (e) { console.warn('[useEventStream] Cleanup error:', e); }
        };
      } else {
        try { sdkUnsub(); } catch {}
      }
    } catch (subscriptionError) {
      console.error('[useEventStream] Error during subscription:', subscriptionError);
      onError(subscriptionError);
    }
  }, [
    shouldHoldConnection,
    stopStream,
    publishStatus,
    checkConnection,
    resyncMessages,
    requestSessionMetadataRefresh,
    handleEvent,
    refreshSessionActivityStatus,
    bootstrapState,
  ]);

  const scheduleReconnect = React.useCallback((hint?: string) => {
    if (!shouldHoldConnection()) {
      pendingResumeRef.current = true;
      stopStream();
      if (!onlineStatusRef.current) {
        publishStatus('offline', 'Waiting for network');
      } else {
        publishStatus('paused', 'Paused while hidden');
      }
      return;
    }

    const nextAttempt = reconnectAttemptsRef.current + 1;
    reconnectAttemptsRef.current = nextAttempt;
    publishStatus('reconnecting', hint ?? `Retrying (${nextAttempt})`);

    const baseDelay = nextAttempt <= 3
      ? Math.min(1000 * Math.pow(2, nextAttempt - 1), 8000)
      : Math.min(2000 * Math.pow(2, nextAttempt - 3), 32000);
    const jitter = Math.floor(Math.random() * 250);

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    reconnectTimeoutRef.current = setTimeout(() => {
      startStream({ resetAttempts: false });
    }, baseDelay + jitter);
  }, [shouldHoldConnection, stopStream, publishStatus, startStream]);

  // ─── Main Effect ────────────────────────────────────────────────────────────

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__messageTracker = trackMessage;
    }

    // Desktop activity phase handler
    let desktopActivityHandler: ((event: CustomEvent<{ sessionId?: string; phase?: string }>) => void) | null = null;
    if (isDesktopRuntimeRef.current && typeof window !== 'undefined') {
      desktopActivityHandler = (event: CustomEvent<{ sessionId?: string; phase?: string }>) => {
        const sessionId = typeof event.detail?.sessionId === 'string' ? event.detail.sessionId : null;
        const phase = typeof event.detail?.phase === 'string' ? event.detail.phase : null;
        if (sessionId && sessionId === currentSessionIdRef.current &&
            (phase === 'idle' || phase === 'busy' || phase === 'cooldown')) {
          updateActivityPhase(phase);
        }
      };
      window.addEventListener('openchamber:session-activity', desktopActivityHandler as EventListener);
    }

    // Visibility / focus / online handlers
    const clearPauseTimeout = () => {
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
        pauseTimeoutRef.current = null;
      }
    };

    const pauseStreamSoon = () => {
      if (pauseTimeoutRef.current) return;
      pauseTimeoutRef.current = setTimeout(() => {
        visibilityStateRef.current = resolveVisibilityState();
        if (visibilityStateRef.current !== 'visible') {
          stopStream();
          pendingResumeRef.current = true;
          publishStatus('paused', 'Paused while hidden');
        } else {
          clearPauseTimeout();
        }
      }, 5000);
    };

    const handleVisibilityChange = () => {
      visibilityStateRef.current = resolveVisibilityState();
      if (visibilityStateRef.current === 'visible') {
        clearPauseTimeout();
        maybeBootstrapIfStale('visibility_restore');
        if (pendingResumeRef.current || !unsubscribeRef.current) {
          if (currentSessionIdRef.current) {
            resyncMessages('visibility_restore').catch(() => {});
            requestSessionMetadataRefresh();
          }
          void refreshSessionActivityStatus();
          publishStatus('connecting', 'Resuming stream');
          startStream({ resetAttempts: true });
        }
      } else {
        publishStatus('paused', 'Paused while hidden');
        pauseStreamSoon();
      }
    };

    const handleWindowFocus = () => {
      visibilityStateRef.current = resolveVisibilityState();
      if (visibilityStateRef.current === 'visible') {
        clearPauseTimeout();
        maybeBootstrapIfStale('window_focus');
        if (pendingResumeRef.current || !unsubscribeRef.current) {
          if (currentSessionIdRef.current) {
            requestSessionMetadataRefresh();
            resyncMessages('window_focus').catch(() => {});
          }
          void refreshSessionActivityStatus();
          publishStatus('connecting', 'Resuming stream');
          startStream({ resetAttempts: true });
        }
      }
    };

    const handleOnline = () => {
      onlineStatusRef.current = true;
      maybeBootstrapIfStale('network_restored');
      if (pendingResumeRef.current || !unsubscribeRef.current) {
        publishStatus('connecting', 'Network restored');
        startStream({ resetAttempts: true });
      }
    };

    const handleOffline = () => {
      onlineStatusRef.current = false;
      pendingResumeRef.current = true;
      publishStatus('offline', 'Waiting for network');
      stopStream();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      window.addEventListener('focus', handleWindowFocus);
    }

    const startTimer = setTimeout(() => {
      startStream({ resetAttempts: true });
    }, 100);

    // Stale stream check
    if (staleCheckIntervalRef.current) {
      clearInterval(staleCheckIntervalRef.current);
    }
    staleCheckIntervalRef.current = setInterval(() => {
      if (!shouldHoldConnection()) return;

      const now = Date.now();
      const currentPhase = useChatStore.getState().activityPhase;
      if (currentPhase === 'busy' || currentPhase === 'cooldown') {
        void refreshSessionActivityStatus();
      }
      if (now - lastEventTimestampRef.current > 45000) {
        Promise.resolve().then(async () => {
          try {
            const healthy = await opencodeClient.checkHealth();
            if (!healthy) {
              scheduleReconnect('Refreshing stalled stream');
            } else {
              lastEventTimestampRef.current = Date.now();
            }
          } catch {
            scheduleReconnect('Refreshing stalled stream');
          }
        });
      }
    }, 10000);

    // Cleanup
    return () => {
      clearTimeout(startTimer);
      if (desktopActivityHandler && typeof window !== 'undefined') {
        window.removeEventListener('openchamber:session-activity', desktopActivityHandler as EventListener);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        window.removeEventListener('focus', handleWindowFocus);
      }
      clearPauseTimeout();
      if (staleCheckIntervalRef.current) {
        clearInterval(staleCheckIntervalRef.current);
        staleCheckIntervalRef.current = null;
      }
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
      notifiedMessagesRef.current.clear();
      notifiedQuestionsRef.current.clear();
      pendingResumeRef.current = false;
      visibilityStateRef.current = resolveVisibilityState();
      onlineStatusRef.current = typeof navigator === 'undefined' ? true : navigator.onLine;
      stopStream();
      publishStatus('idle', null);
    };
  }, [
    effectiveDirectory,
    trackMessage,
    resolveVisibilityState,
    stopStream,
    publishStatus,
    startStream,
    scheduleReconnect,
    requestSessionMetadataRefresh,
    updateActivityPhase,
    refreshSessionActivityStatus,
    shouldHoldConnection,
    maybeBootstrapIfStale,
    resyncMessages,
  ]);
};
