import React from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { cn } from '@/lib/utils';

interface SidebarContextSummaryProps {
    className?: string;
}

const formatSessionTitle = (title?: string | null) => {
    if (!title) {
        return 'Untitled Session';
    }
    const trimmed = title.trim();
    return trimmed.length > 0 ? trimmed : 'Untitled Session';
};

const formatDirectoryPath = (path?: string) => {
    if (!path || path.length === 0) {
        return '/';
    }
    return path;
};

export const SidebarContextSummary: React.FC<SidebarContextSummaryProps> = ({ className }) => {
    const currentSessionId = useChatStore((state) => state.currentSessionId);
    const sessionTitle = useChatStore((state) => state.sessionTitle);
    const { currentDirectory } = useDirectoryStore();

    const activeSessionTitle = React.useMemo(() => {
        if (!currentSessionId) {
            return 'No active session';
        }
        return formatSessionTitle(sessionTitle);
    }, [currentSessionId, sessionTitle]);

    const directoryFull = React.useMemo(() => {
        return formatDirectoryPath(currentDirectory);
    }, [currentDirectory]);

    const directoryDisplay = React.useMemo(() => {
        if (!directoryFull || directoryFull === '/') {
            return directoryFull;
        }
        const segments = directoryFull.split('/').filter(Boolean);
        return segments.length ? segments[segments.length - 1] : directoryFull;
    }, [directoryFull]);

    return (
        <div className={cn('hidden min-h-[48px] flex-col justify-center gap-0.5 border-b bg-sidebar/60 px-3 py-2 backdrop-blur md:flex md:pb-2', className)}>
            <span className="typography-meta text-muted-foreground">Session</span>
            <span className="typography-ui-label font-semibold text-foreground truncate" title={activeSessionTitle}>
                {activeSessionTitle}
            </span>
            <span className="typography-meta text-muted-foreground truncate" title={directoryFull}>
                {directoryDisplay}
            </span>
        </div>
    );
};
