import React from 'react';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { ChatErrorBoundary } from '@/components/chat/ChatErrorBoundary';
import { useChatStore } from '@/stores/useChatStore';

export const ChatView: React.FC = () => {
    const currentSessionId = useChatStore((state) => state.currentSessionId);

    return (
        <ChatErrorBoundary sessionId={currentSessionId || undefined}>
            <ChatContainer />
        </ChatErrorBoundary>
    );
};
