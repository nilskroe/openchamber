import React from 'react';
import { useChatStore } from '@/stores/useChatStore';
import type { ActivityPhase } from '@/stores/types/chatTypes';

export type SessionActivityPhase = ActivityPhase;

export interface SessionActivityResult {
  phase: SessionActivityPhase;
  isWorking: boolean;
  isBusy: boolean;
  isCooldown: boolean;
}

const IDLE_RESULT: SessionActivityResult = {
  phase: 'idle',
  isWorking: false,
  isBusy: false,
  isCooldown: false,
};

export function useSessionActivity(): SessionActivityResult {
  const phase = useChatStore((state) => state.activityPhase);

  return React.useMemo<SessionActivityResult>(() => {
    if (phase === 'idle') {
      return IDLE_RESULT;
    }
    const isBusy = phase === 'busy';
    const isCooldown = phase === 'cooldown';
    return {
      phase,
      isWorking: isBusy || isCooldown,
      isBusy,
      isCooldown,
    };
  }, [phase]);
}

export function useCurrentSessionActivity(): SessionActivityResult {
  return useSessionActivity();
}
