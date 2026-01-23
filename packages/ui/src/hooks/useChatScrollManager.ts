import React from 'react';
import type { Part } from '@opencode-ai/sdk/v2';

import { MessageFreshnessDetector } from '@/lib/messageFreshness';

import { useScrollEngine } from './useScrollEngine';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

export type ContentChangeReason = 'text' | 'structural' | 'permission';

interface ChatMessageRecord {
    info: Record<string, unknown>;
    parts: Part[];
}


interface UseChatScrollManagerOptions {
    currentSessionId: string | null;
    sessionMessages: ChatMessageRecord[];
    isSyncing: boolean;
    isMobile: boolean;
}

export interface AnimationHandlers {
    onChunk: () => void;
    onComplete: () => void;
    onStreamingCandidate?: () => void;
    onAnimationStart?: () => void;
    onReservationCancelled?: () => void;
    onReasoningBlock?: () => void;
    onAnimatedHeightChange?: (height: number) => void;
}

interface UseChatScrollManagerResult {
    scrollRef: React.RefObject<HTMLDivElement | null>;
    handleMessageContentChange: (reason?: ContentChangeReason) => void;
    getAnimationHandlers: (messageId: string) => AnimationHandlers;
    showScrollButton: boolean;
    scrollToBottom: (options?: { instant?: boolean; force?: boolean }) => void;
    scrollToPosition: (position: number, options?: { instant?: boolean }) => void;
    isPinned: boolean;
}

const PROGRAMMATIC_SCROLL_SUPPRESS_MS = 200;
const DIRECT_SCROLL_INTENT_WINDOW_MS = 250;
// Threshold for re-pinning: 10% of container height (matches bottom spacer)
const PIN_THRESHOLD_RATIO = 0.10;

export const useChatScrollManager = ({
    currentSessionId,
    sessionMessages,
    isSyncing,
    isMobile,
}: UseChatScrollManagerOptions): UseChatScrollManagerResult => {
    const scrollRef = React.useRef<HTMLDivElement | null>(null);
    const scrollEngine = useScrollEngine({ containerRef: scrollRef, isMobile });

    const getPinThreshold = React.useCallback(() => {
        const container = scrollRef.current;
        if (!container || container.clientHeight <= 0) {
            return 0;
        }
        const raw = container.clientHeight * PIN_THRESHOLD_RATIO;
        return Math.max(24, Math.min(200, raw));
    }, []);

    const [showScrollButton, setShowScrollButton] = React.useState(false);
    const [isPinned, setIsPinned] = React.useState(true);

    const lastSessionIdRef = React.useRef<string | null>(null);
    const currentSessionIdRef = React.useRef<string | null>(currentSessionId ?? null);
    const suppressUserScrollUntilRef = React.useRef<number>(0);
    const lastDirectScrollIntentAtRef = React.useRef<number>(0);
    const isPinnedRef = React.useRef(true);
    const lastScrollTopRef = React.useRef<number>(0);


    React.useEffect(() => {
        currentSessionIdRef.current = currentSessionId ?? null;
    }, [currentSessionId]);

    const markProgrammaticScroll = React.useCallback(() => {
        suppressUserScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_SUPPRESS_MS;
    }, []);

    const getDistanceFromBottom = React.useCallback(() => {
        const container = scrollRef.current;
        if (!container) return 0;
        return container.scrollHeight - container.scrollTop - container.clientHeight;
    }, []);

    const updatePinnedState = React.useCallback((newPinned: boolean) => {
        if (isPinnedRef.current !== newPinned) {
            isPinnedRef.current = newPinned;
            setIsPinned(newPinned);
        }
    }, []);

    const scrollToBottomInternal = React.useCallback((options?: { instant?: boolean; followBottom?: boolean }) => {
        const container = scrollRef.current;
        if (!container) return;

        const bottom = container.scrollHeight - container.clientHeight;
        markProgrammaticScroll();
        scrollEngine.scrollToPosition(Math.max(0, bottom), options);
    }, [markProgrammaticScroll, scrollEngine]);

    const updateScrollButtonVisibility = React.useCallback(() => {
        const container = scrollRef.current;
        if (!container) {
            setShowScrollButton(false);
            return;
        }

        const hasScrollableContent = container.scrollHeight > container.clientHeight;
        if (!hasScrollableContent) {
            setShowScrollButton(false);
            return;
        }

        // Show scroll button when scrolled above the 10vh threshold
        const distanceFromBottom = getDistanceFromBottom();
        setShowScrollButton(distanceFromBottom > getPinThreshold());
    }, [getDistanceFromBottom, getPinThreshold]);

    const scrollToPosition = React.useCallback((position: number, options?: { instant?: boolean }) => {
        const container = scrollRef.current;
        if (!container) return;

        markProgrammaticScroll();
        scrollEngine.scrollToPosition(Math.max(0, position), options);
    }, [markProgrammaticScroll, scrollEngine]);

    const scrollToBottom = React.useCallback((options?: { instant?: boolean; force?: boolean }) => {
        const container = scrollRef.current;
        if (!container) return;

        // Re-pin when explicitly scrolling to bottom
        updatePinnedState(true);

        scrollToBottomInternal(options);
        setShowScrollButton(false);
    }, [scrollToBottomInternal, updatePinnedState]);

    const handleScrollEvent = React.useCallback((event?: Event) => {
        const container = scrollRef.current;
        if (!container || !currentSessionId) {
            return;
        }

        const now = Date.now();
        const isProgrammatic = now < suppressUserScrollUntilRef.current;
        const hasDirectIntent = now - lastDirectScrollIntentAtRef.current <= DIRECT_SCROLL_INTENT_WINDOW_MS;

        scrollEngine.handleScroll();
        updateScrollButtonVisibility();

        // Handle pin/unpin logic
        const currentScrollTop = container.scrollTop;

        // Unpin requires strict user intent check
        if (event?.isTrusted && !isProgrammatic && hasDirectIntent) {
            const scrollingUp = currentScrollTop < lastScrollTopRef.current;
            if (scrollingUp && isPinnedRef.current) {
                updatePinnedState(false);
            }
        }

        // Re-pin at bottom should always work (even momentum scroll)
        if (!isPinnedRef.current) {
            const distanceFromBottom = getDistanceFromBottom();
            if (distanceFromBottom <= getPinThreshold()) {
                updatePinnedState(true);
            }
        }

        lastScrollTopRef.current = currentScrollTop;

    }, [
        currentSessionId,
        getDistanceFromBottom,
        getPinThreshold,
        scrollEngine,
        sessionMessages.length,
        updatePinnedState,
        updateScrollButtonVisibility,
    ]);

    React.useEffect(() => {
        const container = scrollRef.current;
        if (!container) return;

        const markDirectIntent = () => {
            lastDirectScrollIntentAtRef.current = Date.now();
        };

        container.addEventListener('scroll', handleScrollEvent as EventListener, { passive: true });
        container.addEventListener('wheel', markDirectIntent as EventListener, { passive: true });
        container.addEventListener('touchmove', markDirectIntent as EventListener, { passive: true });

        return () => {
            container.removeEventListener('scroll', handleScrollEvent as EventListener);
            container.removeEventListener('wheel', markDirectIntent as EventListener);
            container.removeEventListener('touchmove', markDirectIntent as EventListener);
        };
    }, [handleScrollEvent]);

    // Session switch - reset state but DON'T scroll yet (let ChatContainer handle scroll after messages load)
    useIsomorphicLayoutEffect(() => {
        if (!currentSessionId || currentSessionId === lastSessionIdRef.current) {
            return;
        }

        lastSessionIdRef.current = currentSessionId;
        MessageFreshnessDetector.getInstance().recordSessionStart(currentSessionId);

        // Reset pinned state to true - we'll be pinned at bottom when messages load
        updatePinnedState(true);
        setShowScrollButton(false);
        lastScrollTopRef.current = 0;

        // DON'T scroll here - let ChatContainer scroll after messages are actually loaded
        // This prevents the race condition where we scroll before messages render
    }, [currentSessionId, updatePinnedState]);

    // Maintain pin-to-bottom when content changes
    React.useEffect(() => {
        if (!isPinnedRef.current) return;
        if (isSyncing) return;

        const container = scrollRef.current;
        if (!container) return;

        // When pinned and content grows, scroll to bottom instantly
        const distanceFromBottom = getDistanceFromBottom();
        if (distanceFromBottom > getPinThreshold()) {
            markProgrammaticScroll();
            scrollToBottomInternal({ instant: true });
        }
    }, [getDistanceFromBottom, getPinThreshold, isSyncing, markProgrammaticScroll, scrollToBottomInternal, sessionMessages]);

    // Use ResizeObserver to detect content changes and maintain pin
    React.useEffect(() => {
        const container = scrollRef.current;
        if (!container || typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(() => {
            updateScrollButtonVisibility();

            // Maintain pin when content grows - always instant for smooth experience
            if (isPinnedRef.current) {
                const distanceFromBottom = getDistanceFromBottom();
                if (distanceFromBottom > getPinThreshold()) {
                    scrollToBottomInternal({ instant: true });
                }
            }
        });

        observer.observe(container);

        // Also observe children for content changes
        const childObserver = new MutationObserver(() => {
            if (isPinnedRef.current) {
                const distanceFromBottom = getDistanceFromBottom();
                if (distanceFromBottom > getPinThreshold()) {
                    scrollToBottomInternal({ instant: true });
                }
            }
        });

        childObserver.observe(container, { childList: true, subtree: true });

        return () => {
            observer.disconnect();
            childObserver.disconnect();
        };
    }, [getDistanceFromBottom, getPinThreshold, scrollToBottomInternal, updateScrollButtonVisibility]);

    React.useEffect(() => {
        if (typeof window === 'undefined') {
            updateScrollButtonVisibility();
            return;
        }

        const rafId = window.requestAnimationFrame(() => {
            updateScrollButtonVisibility();
        });

        return () => {
            window.cancelAnimationFrame(rafId);
        };
    }, [currentSessionId, sessionMessages.length, updateScrollButtonVisibility]);

    const animationHandlersRef = React.useRef<Map<string, AnimationHandlers>>(new Map());

    const handleMessageContentChange = React.useCallback(() => {
        updateScrollButtonVisibility();

        // Maintain pin when content changes - always instant
        if (isPinnedRef.current) {
            const distanceFromBottom = getDistanceFromBottom();
            if (distanceFromBottom > getPinThreshold()) {
                scrollToBottomInternal({ instant: true });
            }
        }
    }, [getDistanceFromBottom, getPinThreshold, scrollToBottomInternal, updateScrollButtonVisibility]);
 
     const getAnimationHandlers = React.useCallback((messageId: string): AnimationHandlers => {
        const existing = animationHandlersRef.current.get(messageId);
        if (existing) {
            return existing;
        }

        const handlers: AnimationHandlers = {
            onChunk: () => {
                updateScrollButtonVisibility();
                if (isPinnedRef.current) {
                    const distanceFromBottom = getDistanceFromBottom();
                    if (distanceFromBottom > getPinThreshold()) {
                        scrollToBottomInternal({ instant: true });
                    }
                }
            },
            onComplete: () => {
                updateScrollButtonVisibility();
            },
            onStreamingCandidate: () => {},
            onAnimationStart: () => {},
            onAnimatedHeightChange: () => {
                updateScrollButtonVisibility();
                if (isPinnedRef.current) {
                    const distanceFromBottom = getDistanceFromBottom();
                    if (distanceFromBottom > getPinThreshold()) {
                        scrollToBottomInternal({ instant: true });
                    }
                }
            },
            onReservationCancelled: () => {},
            onReasoningBlock: () => {},
        };

        animationHandlersRef.current.set(messageId, handlers);
        return handlers;
    }, [getDistanceFromBottom, getPinThreshold, scrollToBottomInternal, updateScrollButtonVisibility]);

    return {
        scrollRef,
        handleMessageContentChange,
        getAnimationHandlers,
        showScrollButton,
        scrollToBottom,
        scrollToPosition,
        isPinned,
    };
};
