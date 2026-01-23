import React from 'react';
import { useChatStore } from '@/stores/useChatStore';

/**
 * Periodically syncs messages for the current session.
 * In the one-chat-per-worktree model, this simply re-fetches
 * messages when the tab regains focus or every 30 seconds.
 */
export const useMessageSync = () => {
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);
  const loadMessages = useChatStore((s) => s.loadMessages);

  const syncTimeoutRef = React.useRef<NodeJS.Timeout | undefined>(undefined);
  const lastSyncRef = React.useRef<number>(0);

  const syncMessages = React.useCallback(async () => {
    if (!currentSessionId) return;
    if (streamingMessageId) return;

    const now = Date.now();
    if (now - lastSyncRef.current < 2000) return;
    lastSyncRef.current = now;

    try {
      await loadMessages();
    } catch (error) {
      console.debug('Background sync failed:', error);
    }
  }, [currentSessionId, streamingMessageId, loadMessages]);

  // Sync on window focus
  React.useEffect(() => {
    const handleFocus = () => {
      syncMessages();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [syncMessages]);

  // Periodic sync every 30s
  React.useEffect(() => {
    if (!currentSessionId || streamingMessageId) return;

    const scheduleSync = () => {
      if (document.visibilityState === 'visible') {
        syncMessages();
      }
      syncTimeoutRef.current = setTimeout(scheduleSync, 30000);
    };

    syncTimeoutRef.current = setTimeout(scheduleSync, 30000);

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [currentSessionId, streamingMessageId, syncMessages]);

  // Sync on tab visibility change
  React.useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncMessages();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [syncMessages]);
};
