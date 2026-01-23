import React from 'react';
import { useGitStore } from '@/stores/useGitStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';

/**
 * Background git polling hook - monitors git status regardless of which tab is open.
 * Must be used inside RuntimeAPIProvider.
 */
export function useGitPolling() {
    const { git } = useRuntimeAPIs();
    const effectiveDirectory = useDirectoryStore((state) => state.currentDirectory) ?? null;
    const { setActiveDirectory, startPolling, stopPolling, fetchAll } = useGitStore();

    React.useEffect(() => {
        if (!effectiveDirectory || !git) {
            stopPolling();
            return;
        }

        setActiveDirectory(effectiveDirectory);

        fetchAll(effectiveDirectory, git);

        startPolling(git);

        return () => {
            stopPolling();
        };
    }, [effectiveDirectory, git, setActiveDirectory, startPolling, stopPolling, fetchAll]);
}
