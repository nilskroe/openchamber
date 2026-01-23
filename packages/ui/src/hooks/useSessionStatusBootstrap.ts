import React from 'react';
import { opencodeClient } from '@/lib/opencode/client';
import { useChatStore } from '@/stores/useChatStore';

type SessionStatusPayload = {
  type: 'idle' | 'busy' | 'retry';
  attempt?: number;
  message?: string;
  next?: number;
};

export const useSessionStatusBootstrap = () => {
  React.useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const currentSessionId = useChatStore.getState().currentSessionId;
        if (!currentSessionId) return;

        const statusMap = await opencodeClient.getGlobalSessionStatus();
        if (cancelled || !statusMap) return;

        const raw = statusMap[currentSessionId];
        if (!raw) return;

        const status = raw as SessionStatusPayload;
        const phase: 'idle' | 'busy' | 'cooldown' =
          status.type === 'busy' || status.type === 'retry' ? 'busy' : 'idle';

        if (phase !== 'idle') {
          useChatStore.setState({ activityPhase: phase });
        }
      } catch { /* ignored */ }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);
};
