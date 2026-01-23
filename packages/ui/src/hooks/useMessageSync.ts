import React from 'react';
import { useChatStore } from '@/stores/useChatStore';

/**
 * Periodically syncs messages for the current session.
 * Re-fetches on tab focus, visibility change, or every 30s.
 */
export const useMessageSync = () => {
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);
  const loadMessages = useChatStore((s) => s.loadMessages);

  const lastSyncRef = React.useRef<number>(0);

  const syncMessages = React.useCallback(() => {
    if (!currentSessionId || streamingMessageId) return;

    const now = Date.now();
    if (now - lastSyncRef.current < 2000) return;
    lastSyncRef.current = now;

    loadMessages().catch((error) => {
      console.debug('Background sync failed:', error);
    });
  }, [currentSessionId, streamingMessageId, loadMessages]);

  React.useEffect(() => {
    if (!currentSessionId || streamingMessageId) return;

    const handleFocus = () => syncMessages();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') syncMessages();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    const interval = setInterval(syncMessages, 30000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(interval);
    };
  }, [currentSessionId, streamingMessageId, syncMessages]);
};
