import { useEffect, useRef, useCallback } from 'react';
import { useAutoReviewStore } from '@/stores/useAutoReviewStore';
import { useChatStore } from '@/stores/useChatStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { toast } from 'sonner';

const DISPATCH_DEBOUNCE_MS = 3000;
const IDLE_CHECK_INTERVAL_MS = 5000;

export function useAutoReviewDispatch() {
  const lastDispatchRef = useRef<number>(0);
  const isDispatchingRef = useRef<boolean>(false);

  const enabled = useAutoReviewStore((state) => state.enabled);
  const getNextItem = useAutoReviewStore((state) => state.getNextItem);
  const markSent = useAutoReviewStore((state) => state.markSent);
  const generatePromptForItem = useAutoReviewStore((state) => state.generatePromptForItem);

  const sendMessage = useChatStore((state) => state.sendMessage);
  const activityPhase = useChatStore((state) => state.activityPhase);

  const { currentProviderId, currentModelId, currentAgentName, currentVariant } = useConfigStore();

  const isSessionIdle = useCallback(() => {
    return activityPhase === 'idle';
  }, [activityPhase]);

  const dispatchToCurrentSession = useCallback(async () => {
    if (isDispatchingRef.current) return false;

    const now = Date.now();
    if (now - lastDispatchRef.current < DISPATCH_DEBOUNCE_MS) {
      return false;
    }

    const nextItem = getNextItem();
    if (!nextItem) return false;

    isDispatchingRef.current = true;
    lastDispatchRef.current = now;

    try {
      const chatState = useChatStore.getState();
      const sessionAgent = chatState.agentSelection || currentAgentName;
      const sessionModel = sessionAgent ? chatState.getAgentModelSelection(sessionAgent) : null;
      const effectiveProviderId = sessionModel?.providerId || currentProviderId;
      const effectiveModelId = sessionModel?.modelId || currentModelId;

      if (!effectiveProviderId || !effectiveModelId) {
        console.warn('[AutoReview] No model configured, skipping dispatch');
        return false;
      }

      const effectiveVariant = sessionAgent && effectiveProviderId && effectiveModelId
        ? chatState.getAgentModelVariantSelection(sessionAgent, effectiveProviderId, effectiveModelId) ?? currentVariant
        : currentVariant;

      const prompt = generatePromptForItem(nextItem);

      await sendMessage(
        prompt,
        effectiveProviderId,
        effectiveModelId,
        sessionAgent,
        undefined,
        undefined,
        undefined,
        effectiveVariant
      );

      markSent(nextItem.id, nextItem.type);

      let itemLabel: string;
      if (nextItem.type === 'conflict') {
        itemLabel = 'Merge conflict';
      } else if (nextItem.type === 'check') {
        const checkData = nextItem.data as { name?: string; context?: string };
        itemLabel = `CI: ${checkData.name || checkData.context || 'Unknown'}`;
      } else {
        itemLabel = 'Review comment';
      }
      toast.success(`Auto-review: ${itemLabel}`, { duration: 2000 });

      return true;
    } catch (error) {
      console.error('[AutoReview] Dispatch failed:', error);
      toast.error('Auto-review dispatch failed');
      return false;
    } finally {
      isDispatchingRef.current = false;
    }
  }, [
    getNextItem,
    markSent,
    generatePromptForItem,
    sendMessage,
    currentProviderId,
    currentModelId,
    currentAgentName,
    currentVariant,
  ]);

  useEffect(() => {
    if (!enabled) return;

    const checkAndDispatch = () => {
      if (isSessionIdle()) {
        void dispatchToCurrentSession();
      }
    };

    const intervalId = setInterval(checkAndDispatch, IDLE_CHECK_INTERVAL_MS);

    checkAndDispatch();

    return () => {
      clearInterval(intervalId);
    };
  }, [enabled, isSessionIdle, dispatchToCurrentSession]);

  // Dispatch when session becomes idle after streaming
  const prevPhaseRef = useRef<string>(activityPhase);

  useEffect(() => {
    if (!enabled) return;

    if (prevPhaseRef.current !== 'idle' && activityPhase === 'idle') {
      setTimeout(() => {
        if (!useAutoReviewStore.getState().enabled) return;
        if (useChatStore.getState().activityPhase === 'idle') {
          void dispatchToCurrentSession();
        }
      }, DISPATCH_DEBOUNCE_MS);
    }

    prevPhaseRef.current = activityPhase;
  }, [enabled, activityPhase, dispatchToCurrentSession]);
}
