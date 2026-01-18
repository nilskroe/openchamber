import React from 'react';
import type { Message, Part } from '@opencode-ai/sdk/v2';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

import ChatMessage from './ChatMessage';
import { PermissionCard } from './PermissionCard';
import { QuestionCard } from './QuestionCard';
import type { PermissionRequest } from '@/types/permission';
import type { QuestionRequest } from '@/types/question';
import type { AnimationHandlers, ContentChangeReason } from '@/hooks/useChatScrollManager';
import { filterSyntheticParts } from '@/lib/messages/synthetic';
import { useTurnGrouping } from './hooks/useTurnGrouping';

const VIRTUALIZATION_THRESHOLD = 30;

interface MessageListProps {
    messages: { info: Message; parts: Part[] }[];
    permissions: PermissionRequest[];
    questions: QuestionRequest[];
    onMessageContentChange: (reason?: ContentChangeReason) => void;
    getAnimationHandlers: (messageId: string) => AnimationHandlers;
    hasMoreAbove: boolean;
    isLoadingOlder: boolean;
    onLoadOlder: () => void;
    scrollToBottom?: (options?: { instant?: boolean; force?: boolean }) => void;
    pendingAnchorId?: string | null;
    virtuosoRef?: React.RefObject<VirtuosoHandle | null>;
    scrollParent?: HTMLElement | null;
}

interface DisplayMessage {
    info: Message;
    parts: Part[];
}

const MessageItem = React.memo(function MessageItem({
    message,
    previousMessage,
    nextMessage,
    onContentChange,
    animationHandlers,
    scrollToBottom,
    isPendingAnchor,
    turnGroupingContext,
}: {
    message: DisplayMessage;
    previousMessage: DisplayMessage | undefined;
    nextMessage: DisplayMessage | undefined;
    onContentChange: (reason?: ContentChangeReason) => void;
    animationHandlers: AnimationHandlers;
    scrollToBottom?: (options?: { instant?: boolean; force?: boolean }) => void;
    isPendingAnchor: boolean;
    turnGroupingContext: ReturnType<ReturnType<typeof useTurnGrouping>['getContextForMessage']>;
}) {
    return (
        <ChatMessage
            message={message}
            previousMessage={previousMessage}
            nextMessage={nextMessage}
            onContentChange={onContentChange}
            animationHandlers={animationHandlers}
            scrollToBottom={scrollToBottom}
            isPendingAnchor={isPendingAnchor}
            turnGroupingContext={turnGroupingContext}
        />
    );
});

const MessageList: React.FC<MessageListProps> = ({
    messages,
    permissions,
    questions,
    onMessageContentChange,
    getAnimationHandlers,
    hasMoreAbove,
    isLoadingOlder,
    onLoadOlder,
    scrollToBottom,
    pendingAnchorId,
    virtuosoRef,
    scrollParent,
}) => {
    const internalVirtuosoRef = React.useRef<VirtuosoHandle>(null);
    const effectiveVirtuosoRef = virtuosoRef ?? internalVirtuosoRef;

    React.useEffect(() => {
        if (permissions.length === 0 && questions.length === 0) {
            return;
        }
        onMessageContentChange('permission');
    }, [permissions, questions, onMessageContentChange]);

    const displayMessages = React.useMemo(() => {
        const seenIds = new Set<string>();
        return messages
            .filter((message) => {
                const messageId = message.info?.id;
                if (typeof messageId === 'string') {
                    if (seenIds.has(messageId)) {
                        return false;
                    }
                    seenIds.add(messageId);
                }
                return true;
            })
            .map((message) => ({
                ...message,
                parts: filterSyntheticParts(message.parts),
            }));
    }, [messages]);

    const { getContextForMessage } = useTurnGrouping(displayMessages);

    const shouldVirtualize = displayMessages.length >= VIRTUALIZATION_THRESHOLD;

    const handleStartReached = React.useCallback(() => {
        if (hasMoreAbove && !isLoadingOlder) {
            onLoadOlder();
        }
    }, [hasMoreAbove, isLoadingOlder, onLoadOlder]);

    const LoadOlderHeader = React.useMemo(() => {
        if (!hasMoreAbove) return null;
        return (
            <div className="flex justify-center py-3">
                {isLoadingOlder ? (
                    <span className="text-xs uppercase tracking-wide text-muted-foreground/80">
                        Loading…
                    </span>
                ) : (
                    <button
                        type="button"
                        onClick={onLoadOlder}
                        className="text-xs uppercase tracking-wide text-muted-foreground/80 hover:text-foreground"
                    >
                        Load older messages
                    </button>
                )}
            </div>
        );
    }, [hasMoreAbove, isLoadingOlder, onLoadOlder]);

    const BlockingCardsFooter = React.useMemo(() => {
        if (questions.length === 0 && permissions.length === 0) return null;
        return (
            <div>
                {questions.map((question) => (
                    <QuestionCard key={question.id} question={question} />
                ))}
                {permissions.map((permission) => (
                    <PermissionCard key={permission.id} permission={permission} />
                ))}
            </div>
        );
    }, [questions, permissions]);

    const renderMessageItem = React.useCallback(
        (index: number) => {
            const message = displayMessages[index];
            if (!message) return null;

            return (
                <MessageItem
                    message={message}
                    previousMessage={index > 0 ? displayMessages[index - 1] : undefined}
                    nextMessage={index < displayMessages.length - 1 ? displayMessages[index + 1] : undefined}
                    onContentChange={onMessageContentChange}
                    animationHandlers={getAnimationHandlers(message.info.id)}
                    scrollToBottom={scrollToBottom}
                    isPendingAnchor={pendingAnchorId === message.info.id}
                    turnGroupingContext={getContextForMessage(message.info.id)}
                />
            );
        },
        [displayMessages, onMessageContentChange, getAnimationHandlers, scrollToBottom, pendingAnchorId, getContextForMessage]
    );

    if (!shouldVirtualize) {
        return (
            <div>
                {LoadOlderHeader}
                <div className="flex flex-col">
                    {displayMessages.map((message, index) => (
                        <ChatMessage
                            key={message.info.id}
                            message={message}
                            previousMessage={index > 0 ? displayMessages[index - 1] : undefined}
                            nextMessage={index < displayMessages.length - 1 ? displayMessages[index + 1] : undefined}
                            onContentChange={onMessageContentChange}
                            animationHandlers={getAnimationHandlers(message.info.id)}
                            scrollToBottom={scrollToBottom}
                            isPendingAnchor={pendingAnchorId === message.info.id}
                            turnGroupingContext={getContextForMessage(message.info.id)}
                        />
                    ))}
                </div>
                {BlockingCardsFooter}
            </div>
        );
    }

    return (
        <Virtuoso
            ref={effectiveVirtuosoRef}
            data={displayMessages}
            itemContent={renderMessageItem}
            components={{
                Header: LoadOlderHeader ? () => LoadOlderHeader : undefined,
                Footer: BlockingCardsFooter ? () => BlockingCardsFooter : undefined,
            }}
            customScrollParent={scrollParent ?? undefined}
            overscan={200}
            computeItemKey={(index, item) => item.info.id}
            defaultItemHeight={120}
            increaseViewportBy={{ top: 400, bottom: 400 }}
            startReached={handleStartReached}
        />
    );
};

export default React.memo(MessageList);
