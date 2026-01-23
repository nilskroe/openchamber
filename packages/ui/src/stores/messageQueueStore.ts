import { create } from 'zustand';
import { devtools, persist, createJSONStorage } from 'zustand/middleware';
import { getSafeStorage } from './utils/safeStorage';
import type { AttachedFile } from './types/chatTypes';
import { updateDesktopSettings } from '@/lib/persistence';

export interface QueuedMessage {
    id: string;
    content: string;
    attachments?: AttachedFile[];
    createdAt: number;
}

export type QueueSendBehavior = 'all' | 'first-only';

interface MessageQueueState {
    queuedMessages: Record<string, QueuedMessage[]>;
    queueModeEnabled: boolean;
    queueSendBehavior: QueueSendBehavior;
}

interface MessageQueueActions {
    addToQueue: (sessionId: string, message: Omit<QueuedMessage, 'id' | 'createdAt'>) => void;
    removeFromQueue: (sessionId: string, messageId: string) => void;
    popToInput: (sessionId: string, messageId: string) => QueuedMessage | null;
    shiftFirstFromQueue: (sessionId: string) => QueuedMessage | null;
    clearQueue: (sessionId: string) => void;
    clearAllQueues: () => void;
    setQueueMode: (enabled: boolean) => void;
    setQueueSendBehavior: (behavior: QueueSendBehavior) => void;
    getQueueForSession: (sessionId: string) => QueuedMessage[];
}

type MessageQueueStore = MessageQueueState & MessageQueueActions;

export const useMessageQueueStore = create<MessageQueueStore>()(
    devtools(
        persist(
            (set, get) => ({
                queuedMessages: {},
                queueModeEnabled: false,
                queueSendBehavior: 'first-only' as QueueSendBehavior,

                addToQueue: (sessionId, message) => {
                    const id = `queued-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                    const queuedMessage: QueuedMessage = {
                        id,
                        content: message.content,
                        attachments: message.attachments,
                        createdAt: Date.now(),
                    };

                    set((state) => {
                        const currentQueue = state.queuedMessages[sessionId] ?? [];
                        return {
                            queuedMessages: {
                                ...state.queuedMessages,
                                [sessionId]: [...currentQueue, queuedMessage],
                            },
                        };
                    });
                },

                removeFromQueue: (sessionId, messageId) => {
                    set((state) => {
                        const currentQueue = state.queuedMessages[sessionId] ?? [];
                        const newQueue = currentQueue.filter((m) => m.id !== messageId);
                        
                        if (newQueue.length === 0) {
                            const { [sessionId]: _removed, ...rest } = state.queuedMessages;
                            void _removed;
                            return { queuedMessages: rest };
                        }
                        
                        return {
                            queuedMessages: {
                                ...state.queuedMessages,
                                [sessionId]: newQueue,
                            },
                        };
                    });
                },

                popToInput: (sessionId, messageId) => {
                    const state = get();
                    const currentQueue = state.queuedMessages[sessionId] ?? [];
                    const message = currentQueue.find((m) => m.id === messageId);
                    
                    if (!message) {
                        return null;
                    }

                    // Remove from queue
                    set((prevState) => {
                        const queue = prevState.queuedMessages[sessionId] ?? [];
                        const newQueue = queue.filter((m) => m.id !== messageId);
                        
                        if (newQueue.length === 0) {
                            const { [sessionId]: _removed, ...rest } = prevState.queuedMessages;
                            void _removed;
                            return { queuedMessages: rest };
                        }
                        
                        return {
                            queuedMessages: {
                                ...prevState.queuedMessages,
                                [sessionId]: newQueue,
                            },
                        };
                    });

                    return message;
                },

                clearQueue: (sessionId) => {
                    set((state) => {
                        const { [sessionId]: _removed, ...rest } = state.queuedMessages;
                        void _removed;
                        return { queuedMessages: rest };
                    });
                },

                clearAllQueues: () => {
                    set({ queuedMessages: {} });
                },

                setQueueMode: (enabled) => {
                    set({ queueModeEnabled: enabled });
                    void updateDesktopSettings({ queueModeEnabled: enabled });
                },

                setQueueSendBehavior: (behavior) => {
                    set({ queueSendBehavior: behavior });
                    void updateDesktopSettings({ queueSendBehavior: behavior });
                },

                shiftFirstFromQueue: (sessionId) => {
                    const state = get();
                    const currentQueue = state.queuedMessages[sessionId] ?? [];
                    if (currentQueue.length === 0) return null;

                    const [first, ...rest] = currentQueue;

                    set((prevState) => {
                        if (rest.length === 0) {
                            const { [sessionId]: _removed, ...remaining } = prevState.queuedMessages;
                            void _removed;
                            return { queuedMessages: remaining };
                        }
                        return {
                            queuedMessages: {
                                ...prevState.queuedMessages,
                                [sessionId]: rest,
                            },
                        };
                    });

                    return first;
                },

                getQueueForSession: (sessionId) => {
                    return get().queuedMessages[sessionId] ?? [];
                },
            }),
            {
                name: 'message-queue-store',
                storage: createJSONStorage(() => getSafeStorage()),
                partialize: (state) => ({
                    queuedMessages: state.queuedMessages,
                    queueModeEnabled: state.queueModeEnabled,
                    queueSendBehavior: state.queueSendBehavior,
                }),
            }
        ),
        {
            name: 'message-queue-store',
        }
    )
);
