import React from 'react';
import { RiArrowDownLine } from '@remixicon/react';

import { ChatInput } from './ChatInput';
import { useChatStore } from '@/stores/useChatStore';
import { useUIStore } from '@/stores/useUIStore';
import { Skeleton } from '@/components/ui/skeleton';
import ChatEmptyState from './ChatEmptyState';
import MessageList from './MessageList';
import { ScrollShadow } from '@/components/ui/ScrollShadow';
import { useChatScrollManager } from '@/hooks/useChatScrollManager';
import { useDeviceInfo } from '@/lib/device';
import { Button } from '@/components/ui/button';
import { OverlayScrollbar } from '@/components/ui/OverlayScrollbar';
import { TimelineDialog } from './TimelineDialog';
import { ConnectionStatusBanner } from '@/components/ui/ConnectionStatusIndicator';

export const ChatContainer: React.FC = () => {
    const currentSessionId = useChatStore((s) => s.currentSessionId);
    const messages = useChatStore((s) => s.messages);
    const permissions = useChatStore((s) => s.permissions);
    const questions = useChatStore((s) => s.questions);
    const streamingMessageId = useChatStore((s) => s.streamingMessageId);
    const isLoading = useChatStore((s) => s.isLoading);
    const isSyncing = useChatStore((s) => s.isSyncing);
    const hasMoreAbove = useChatStore((s) => s.hasMoreAbove);
    const activityPhase = useChatStore((s) => s.activityPhase);
    const loadMessages = useChatStore((s) => s.loadMessages);
    const loadMoreMessages = useChatStore((s) => s.loadMoreMessages);

    const isTimelineDialogOpen = useUIStore((s) => s.isTimelineDialogOpen);
    const setTimelineDialogOpen = useUIStore((s) => s.setTimelineDialogOpen);

    const { isMobile } = useDeviceInfo();

    const {
        scrollRef,
        handleMessageContentChange,
        getAnimationHandlers,
        showScrollButton,
        scrollToBottom,
        scrollToPosition,
        isPinned,
    } = useChatScrollManager({
        currentSessionId,
        sessionMessages: messages,
        isSyncing,
        isMobile,
    });

    const [isLoadingOlder, setIsLoadingOlder] = React.useState(false);
    React.useEffect(() => {
        setIsLoadingOlder(false);
    }, [currentSessionId]);

    const handleLoadOlder = React.useCallback(async () => {
        if (!currentSessionId || isLoadingOlder) return;

        const container = scrollRef.current;
        const prevHeight = container?.scrollHeight ?? null;
        const prevTop = container?.scrollTop ?? null;

        setIsLoadingOlder(true);
        try {
            await loadMoreMessages('up');
            if (container && prevHeight !== null && prevTop !== null) {
                const heightDiff = container.scrollHeight - prevHeight;
                scrollToPosition(prevTop + heightDiff, { instant: true });
            }
        } finally {
            setIsLoadingOlder(false);
        }
    }, [currentSessionId, isLoadingOlder, loadMoreMessages, scrollRef, scrollToPosition]);

    // Scroll to a specific message by ID (for timeline dialog)
    const scrollToMessage = React.useCallback((messageId: string) => {
        const container = scrollRef.current;
        if (!container) return;

        const messageElement = container.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement;
        if (messageElement) {
            const containerRect = container.getBoundingClientRect();
            const messageRect = messageElement.getBoundingClientRect();
            const offset = 50;
            const scrollTop = messageRect.top - containerRect.top + container.scrollTop - offset;
            container.scrollTo({ top: scrollTop, behavior: 'smooth' });
        }
    }, [scrollRef]);

    // Track if we've scrolled for this session
    const scrolledRef = React.useRef(false);
    const loadingRef = React.useRef(false);

    React.useEffect(() => {
        scrolledRef.current = false;
    }, [currentSessionId]);

    // Load messages and scroll to bottom on session switch
    React.useEffect(() => {
        if (!currentSessionId) return;

        if (messages.length > 0) {
            if (scrolledRef.current) return;
            scrolledRef.current = true;
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    scrollToBottom({ instant: true });
                });
            });
            return;
        }

        if (loadingRef.current) return;
        loadingRef.current = true;

        const load = async () => {
            try {
                await loadMessages();
            } finally {
                loadingRef.current = false;
                scrolledRef.current = true;

                const isActivePhase = activityPhase === 'busy' || activityPhase === 'cooldown';
                const shouldSkipScroll = isActivePhase && isPinned;

                if (!shouldSkipScroll) {
                    window.requestAnimationFrame(() => {
                        window.requestAnimationFrame(() => {
                            scrollToBottom({ instant: true });
                        });
                    });
                }
            }
        };

        void load();
    }, [currentSessionId, messages.length, isPinned, loadMessages, scrollToBottom, activityPhase]);

    if (!currentSessionId) {
        return (
            <div
                className="flex flex-col h-full bg-background transform-gpu"
                style={isMobile ? { paddingBottom: 'var(--oc-keyboard-inset, 0px)' } : undefined}
            >
                <div className="flex-1 flex items-center justify-center">
                    <ChatEmptyState />
                </div>
                <div className="relative bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 z-10">
                    <ChatInput scrollToBottom={scrollToBottom} />
                </div>
            </div>
        );
    }

    if (isLoading && messages.length === 0 && !streamingMessageId) {
        return (
            <div
                className="flex flex-col h-full bg-background gap-0"
                style={isMobile ? { paddingBottom: 'var(--oc-keyboard-inset, 0px)' } : undefined}
            >
                <div className="flex-1 overflow-y-auto p-4 bg-background">
                    <div className="chat-message-column space-y-4">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="flex gap-3 p-4">
                                <Skeleton className="h-8 w-8 rounded-full" />
                                <div className="flex-1 space-y-2">
                                    <Skeleton className="h-4 w-24" />
                                    <Skeleton className="h-20 w-full" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <ChatInput scrollToBottom={scrollToBottom} />
            </div>
        );
    }

    if (messages.length === 0 && !streamingMessageId) {
        return (
            <div
                className="flex flex-col h-full bg-background transform-gpu"
                style={isMobile ? { paddingBottom: 'var(--oc-keyboard-inset, 0px)' } : undefined}
            >
                <div className="flex-1 flex items-center justify-center">
                    <ChatEmptyState />
                </div>
                <div className="relative bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 z-10">
                    <ChatInput scrollToBottom={scrollToBottom} />
                </div>
            </div>
        );
    }

    return (
        <div
            className="flex flex-col h-full bg-background"
            style={isMobile ? { paddingBottom: 'var(--oc-keyboard-inset, 0px)' } : undefined}
        >
            <ConnectionStatusBanner />
            <div className="relative flex-1 min-h-0">
                <div className="absolute inset-0">
                    <ScrollShadow
                        className="absolute inset-0 overflow-y-auto overflow-x-hidden z-0 chat-scroll overlay-scrollbar-target"
                        ref={scrollRef}
                        style={{
                            contain: 'strict',
                            ['--scroll-shadow-size' as string]: '48px',
                        }}
                        data-scroll-shadow="true"
                        data-scrollbar="chat"
                    >
                        <div className="relative z-0 min-h-full">
                            <MessageList
                                messages={messages}
                                permissions={permissions}
                                questions={questions}
                                onMessageContentChange={handleMessageContentChange}
                                getAnimationHandlers={getAnimationHandlers}
                                hasMoreAbove={hasMoreAbove}
                                isLoadingOlder={isLoadingOlder}
                                onLoadOlder={handleLoadOlder}
                                scrollToBottom={scrollToBottom}
                            />
                        </div>
                    </ScrollShadow>
                    <OverlayScrollbar containerRef={scrollRef} />
                </div>
            </div>

            <div className="relative bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 z-10">
                {showScrollButton && messages.length > 0 && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => scrollToBottom({ force: true })}
                            className="rounded-full h-8 w-8 p-0 shadow-none bg-background/95 hover:bg-accent"
                            aria-label="Scroll to bottom"
                        >
                            <RiArrowDownLine className="h-4 w-4" />
                        </Button>
                    </div>
                )}
                <ChatInput scrollToBottom={scrollToBottom} />
            </div>

            <TimelineDialog
                open={isTimelineDialogOpen}
                onOpenChange={setTimelineDialogOpen}
                onScrollToMessage={scrollToMessage}
            />
        </div>
    );
};
