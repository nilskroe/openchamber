import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DirectoryTree } from './DirectoryTree';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useFileSystemAccess } from '@/hooks/useFileSystemAccess';
import { cn, formatPathForDisplay } from '@/lib/utils';
import { toast } from 'sonner';
import {
  RiCheckboxBlankLine,
  RiCheckboxLine,
  RiGithubLine,
  RiFolder6Line,
  RiSearchLine,
  RiLoader4Line,
  RiAlertLine,
} from '@remixicon/react';
import { useDeviceInfo } from '@/lib/device';
import { MobileOverlayPanel } from '@/components/ui/MobileOverlayPanel';
import { DirectoryAutocomplete, type DirectoryAutocompleteHandle } from './DirectoryAutocomplete';
import { AnimatedTabs } from '@/components/ui/animated-tabs';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { opencodeClient, type GitHubRepo } from '@/lib/opencode/client';

const SHOW_HIDDEN_STORAGE_KEY = 'directoryTreeShowHidden';

type SourceTab = 'local' | 'github';

interface DirectoryExplorerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const DirectoryExplorerDialog: React.FC<DirectoryExplorerDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { currentDirectory, homeDirectory, isHomeReady } = useDirectoryStore();
  const { addProject, getActiveProject } = useProjectsStore();
  const [pendingPath, setPendingPath] = React.useState<string | null>(null);
  const [pathInputValue, setPathInputValue] = React.useState('');
  const [hasUserSelection, setHasUserSelection] = React.useState(false);
  const [isConfirming, setIsConfirming] = React.useState(false);
  const [showHidden, setShowHidden] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    try {
      const stored = window.localStorage.getItem(SHOW_HIDDEN_STORAGE_KEY);
      if (stored === 'true') {
        return true;
      }
      if (stored === 'false') {
        return false;
      }
    } catch { /* ignored */ }
    return false;
  });
  const { isDesktop, requestAccess, startAccessing } = useFileSystemAccess();
  const { isMobile } = useDeviceInfo();
  const [autocompleteVisible, setAutocompleteVisible] = React.useState(false);
  const autocompleteRef = React.useRef<DirectoryAutocompleteHandle>(null);

  const [activeTab, setActiveTab] = React.useState<SourceTab>('local');
  const [githubRepos, setGithubRepos] = React.useState<GitHubRepo[]>([]);
  const [githubLoading, setGithubLoading] = React.useState(false);
  const [githubError, setGithubError] = React.useState<string | null>(null);
  const [githubSearch, setGithubSearch] = React.useState('');
  const [selectedRepo, setSelectedRepo] = React.useState<GitHubRepo | null>(null);
  const [cloneDirectory, setCloneDirectory] = React.useState<string>('');

  // Helper to format path for display
  const formatPath = React.useCallback((path: string | null) => {
    if (!path) return '';
    return formatPathForDisplay(path, homeDirectory);
  }, [homeDirectory]);

  React.useEffect(() => {
    if (open) {
      setHasUserSelection(false);
      setIsConfirming(false);
      setAutocompleteVisible(false);
      setActiveTab('local');
      setSelectedRepo(null);
      setGithubSearch('');
      setGithubError(null);
      setGithubRepos([]);
      const activeProject = getActiveProject();
      const initialPath = activeProject?.path || currentDirectory || homeDirectory || '';
      setPendingPath(initialPath);
      setPathInputValue(formatPath(initialPath));
      if (homeDirectory) {
        const openChamberRoot = `${homeDirectory}/openchamber`;
        setCloneDirectory(openChamberRoot);
      }
    }
  }, [open, currentDirectory, homeDirectory, formatPath, getActiveProject]);

  React.useEffect(() => {
    if (!open || activeTab !== 'github') return;
    if (githubRepos.length > 0) return;

    setGithubLoading(true);
    setGithubError(null);

    opencodeClient.listGitHubRepos()
      .then((repos) => {
        setGithubRepos(repos);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to fetch repositories';
        if (message.includes('gh') || message.includes('not found') || message.includes('not installed')) {
          setGithubError('GitHub CLI (gh) not found. Install it from https://cli.github.com');
        } else if (message.includes('auth') || message.includes('login')) {
          setGithubError('Not logged in. Run "gh auth login" in your terminal.');
        } else {
          setGithubError(message);
        }
      })
      .finally(() => {
        setGithubLoading(false);
      });
  }, [open, activeTab, githubRepos.length]);

  // Set initial pending path to home when ready (only if not yet selected)
  React.useEffect(() => {
    if (!open || hasUserSelection || pendingPath) {
      return;
    }
    if (homeDirectory && isHomeReady) {
      setPendingPath(homeDirectory);
      setHasUserSelection(true);
      setPathInputValue('~');
    }
  }, [open, hasUserSelection, pendingPath, homeDirectory, isHomeReady]);

  // Persist show hidden setting
  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(SHOW_HIDDEN_STORAGE_KEY, showHidden ? 'true' : 'false');
    } catch { /* ignored */ }
  }, [showHidden]);

  const handleClose = React.useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const finalizeSelection = React.useCallback(async (targetPath: string) => {
    if (!targetPath || isConfirming) {
      return;
    }
    setIsConfirming(true);
    try {
      let resolvedPath = targetPath;
      let projectId: string | undefined;

      if (isDesktop) {
        const accessResult = await requestAccess(targetPath);
        if (!accessResult.success) {
          toast.error('Unable to access directory', {
            description: accessResult.error || 'Desktop denied directory access.',
          });
          return;
        }
        resolvedPath = accessResult.path ?? targetPath;
        projectId = accessResult.projectId;

        const startResult = await startAccessing(resolvedPath);
        if (!startResult.success) {
          toast.error('Failed to open directory', {
            description: startResult.error || 'Desktop could not grant file access.',
          });
          return;
        }
      }

      const added = addProject(resolvedPath, { id: projectId });
      if (!added) {
        toast.error('Failed to add project', {
          description: 'Please select a valid directory path.',
        });
        return;
      }

      handleClose();
    } catch (error) {
      toast.error('Failed to select directory', {
        description: error instanceof Error ? error.message : 'Unknown error occurred.',
      });
    } finally {
      setIsConfirming(false);
    }
  }, [
    addProject,
    handleClose,
    isDesktop,
    requestAccess,
    startAccessing,
    isConfirming,
  ]);

  const handleConfirm = React.useCallback(async () => {
    const pathToUse = pathInputValue.trim() || pendingPath;
    if (!pathToUse) {
      return;
    }
    await finalizeSelection(pathToUse);
  }, [finalizeSelection, pathInputValue, pendingPath]);

  const handleSelectPath = React.useCallback((path: string) => {
    setPendingPath(path);
    setHasUserSelection(true);
    setPathInputValue(formatPath(path));
  }, [formatPath]);

  const handleDoubleClickPath = React.useCallback(async (path: string) => {
    setPendingPath(path);
    setHasUserSelection(true);
    setPathInputValue(formatPath(path));
    await finalizeSelection(path);
  }, [finalizeSelection, formatPath]);

  const handlePathInputChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setPathInputValue(value);
    setHasUserSelection(true);
    // Show autocomplete when typing a path
    setAutocompleteVisible(value.startsWith('/') || value.startsWith('~'));
    // Update pending path if it looks like a valid path
    if (value.startsWith('/') || value.startsWith('~')) {
      // Expand ~ to home directory
      const expandedPath = value.startsWith('~') && homeDirectory
        ? value.replace(/^~/, homeDirectory)
        : value;
      setPendingPath(expandedPath);
    }
  }, [homeDirectory]);

  const handlePathInputKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Let autocomplete handle the key first if visible
    if (autocompleteRef.current?.handleKeyDown(e)) {
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    }
  }, [handleConfirm]);

  const handleAutocompleteSuggestion = React.useCallback((path: string) => {
    setPendingPath(path);
    setHasUserSelection(true);
    setPathInputValue(formatPath(path));
    // Keep autocomplete open to allow further drilling down
  }, [formatPath]);

  const handleAutocompleteClose = React.useCallback(() => {
    setAutocompleteVisible(false);
  }, []);

  const toggleShowHidden = React.useCallback(() => {
    setShowHidden(prev => !prev);
  }, []);

  const filteredGithubRepos = React.useMemo(() => {
    if (!githubSearch.trim()) return githubRepos;
    const search = githubSearch.toLowerCase();
    return githubRepos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(search) ||
        repo.fullName.toLowerCase().includes(search) ||
        (repo.description && repo.description.toLowerCase().includes(search))
    );
  }, [githubRepos, githubSearch]);

  const handleCloneAndAdd = React.useCallback(async () => {
    if (!selectedRepo || !cloneDirectory || isConfirming) return;

    setIsConfirming(true);
    try {
      const targetPath = `${cloneDirectory}/${selectedRepo.name}`;
      const result = await opencodeClient.cloneGitHubRepo(selectedRepo.cloneUrl, targetPath);

      if (!result.success) {
        toast.error('Failed to clone repository');
        return;
      }

      const added = addProject(result.path);
      if (!added) {
        toast.error('Failed to add project', {
          description: 'Repository was cloned but could not be added as a project.',
        });
        return;
      }

      toast.success('Repository cloned and added', {
        description: selectedRepo.fullName,
      });
      handleClose();
    } catch (error) {
      toast.error('Failed to clone repository', {
        description: error instanceof Error ? error.message : 'Unknown error occurred.',
      });
    } finally {
      setIsConfirming(false);
    }
  }, [selectedRepo, cloneDirectory, isConfirming, addProject, handleClose]);



  const showHiddenToggle = (
    <button
      type="button"
      onClick={toggleShowHidden}
      className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-accent/40 transition-colors typography-meta text-muted-foreground flex-shrink-0"
    >
      {showHidden ? (
        <RiCheckboxLine className="h-4 w-4 text-primary" />
      ) : (
        <RiCheckboxBlankLine className="h-4 w-4" />
      )}
      Show hidden
    </button>
  );

  const tabsSection = (
    <AnimatedTabs
      tabs={[
        { value: 'local', label: 'Local', icon: RiFolder6Line },
        { value: 'github', label: 'GitHub', icon: RiGithubLine },
      ]}
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as SourceTab)}
      className="w-full"
    />
  );

  const githubContent = (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-3">
      <div className="relative">
        <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={githubSearch}
          onChange={(e) => setGithubSearch(e.target.value)}
          placeholder="Search repositories..."
          className="pl-9 typography-meta"
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className="flex-1 min-h-0 rounded-xl border border-border/40 bg-sidebar/70 overflow-hidden">
        {githubLoading ? (
          <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
            <RiLoader4Line className="h-5 w-5 animate-spin" />
            <span className="typography-meta">Loading repositories...</span>
          </div>
        ) : githubError ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-center">
            <RiAlertLine className="h-6 w-6 text-destructive" />
            <span className="typography-meta text-muted-foreground">{githubError}</span>
          </div>
        ) : (
          <ScrollableOverlay className="h-full max-h-[320px]">
            <div className="p-2 space-y-1">
              {filteredGithubRepos.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground typography-meta">
                  {githubSearch ? 'No matching repositories' : 'No repositories found'}
                </div>
              ) : (
                filteredGithubRepos.map((repo) => (
                  <button
                    key={repo.fullName}
                    type="button"
                    onClick={() => setSelectedRepo(repo)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-lg transition-colors',
                      'hover:bg-accent/40',
                      selectedRepo?.fullName === repo.fullName && 'bg-accent/60'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <RiGithubLine className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <span className="typography-meta font-medium truncate">{repo.fullName}</span>
                      {repo.isPrivate && (
                        <span className="typography-micro px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          Private
                        </span>
                      )}
                    </div>
                    {repo.description && (
                      <p className="typography-micro text-muted-foreground mt-1 line-clamp-1 pl-6">
                        {repo.description}
                      </p>
                    )}
                  </button>
                ))
              )}
            </div>
          </ScrollableOverlay>
        )}
      </div>

      {selectedRepo && (
        <div className="flex-shrink-0 space-y-2">
          <label className="typography-micro text-muted-foreground">Clone to directory:</label>
          <Input
            value={cloneDirectory}
            onChange={(e) => setCloneDirectory(e.target.value)}
            placeholder="~/openchamber"
            className="font-mono typography-meta"
            spellCheck={false}
          />
          <p className="typography-micro text-muted-foreground">
            Will clone to: {cloneDirectory.startsWith('~') && homeDirectory
              ? cloneDirectory.replace(/^~/, homeDirectory)
              : cloneDirectory}/{selectedRepo.name}
          </p>
        </div>
      )}
    </div>
  );

  const dialogHeader = (
    <DialogHeader className="flex-shrink-0 px-4 pb-2 pt-[calc(var(--oc-safe-area-top,0px)+0.5rem)] sm:px-0 sm:pb-3 sm:pt-0">
      <DialogTitle>Add project</DialogTitle>
      <DialogDescription className="hidden sm:block">
        Choose a local folder or clone from GitHub.
      </DialogDescription>
    </DialogHeader>
  );

  const pathInputSection = (
    <div className="relative">
      <Input
        value={pathInputValue}
        onChange={handlePathInputChange}
        onKeyDown={handlePathInputKeyDown}
        placeholder="Enter path or select from tree..."
        className="font-mono typography-meta"
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
      />
      <DirectoryAutocomplete
        ref={autocompleteRef}
        inputValue={pathInputValue}
        homeDirectory={homeDirectory}
        onSelectSuggestion={handleAutocompleteSuggestion}
        visible={autocompleteVisible}
        onClose={handleAutocompleteClose}
        showHidden={showHidden}
      />
    </div>
  );

  const treeSection = (
    <div className="flex-1 min-h-0 rounded-xl border border-border/40 bg-sidebar/70 overflow-hidden flex flex-col">
      <DirectoryTree
        variant="inline"
        currentPath={pendingPath ?? currentDirectory}
        onSelectPath={handleSelectPath}
        onDoubleClickPath={handleDoubleClickPath}
        className="flex-1 min-h-0 sm:min-h-[280px] sm:max-h-[380px]"
        selectionBehavior="deferred"
        showHidden={showHidden}
        rootDirectory={isHomeReady ? homeDirectory : null}
        isRootReady={isHomeReady}
      />
    </div>
  );

  const mobileLocalContent = (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="flex-shrink-0">{pathInputSection}</div>
      <div className="flex-shrink-0 flex items-center justify-end">
        {showHiddenToggle}
      </div>
      <div className="flex-1 min-h-0 rounded-xl border border-border/40 bg-sidebar/70 overflow-hidden flex flex-col">
        <DirectoryTree
          variant="inline"
          currentPath={pendingPath ?? currentDirectory}
          onSelectPath={handleSelectPath}
          onDoubleClickPath={handleDoubleClickPath}
          className="flex-1 min-h-0"
          selectionBehavior="deferred"
          showHidden={showHidden}
          rootDirectory={isHomeReady ? homeDirectory : null}
          isRootReady={isHomeReady}
          alwaysShowActions
        />
      </div>
    </div>
  );

  const mobileContent = (
    <div className="flex flex-col gap-3 h-full">
      {tabsSection}
      {activeTab === 'local' ? mobileLocalContent : githubContent}
    </div>
  );

  const localContent = (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex-1">{pathInputSection}</div>
        {showHiddenToggle}
      </div>
      {treeSection}
    </div>
  );

  const desktopContent = (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-3">
      {tabsSection}
      {activeTab === 'local' ? localContent : githubContent}
    </div>
  );

  const renderActionButtons = () => {
    const isLocalTab = activeTab === 'local';
    const localDisabled = isConfirming || !hasUserSelection || (!pendingPath && !pathInputValue.trim());
    const githubDisabled = isConfirming || !selectedRepo || !cloneDirectory.trim();

    return (
      <>
        <Button
          variant="ghost"
          onClick={handleClose}
          disabled={isConfirming}
          className="flex-1 sm:flex-none sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          onClick={isLocalTab ? handleConfirm : handleCloneAndAdd}
          disabled={isLocalTab ? localDisabled : githubDisabled}
          className="flex-1 sm:flex-none sm:w-auto sm:min-w-[140px]"
        >
          {isConfirming
            ? isLocalTab ? 'Adding...' : 'Cloning...'
            : isLocalTab ? 'Add Project' : 'Clone & Add'}
        </Button>
      </>
    );
  };

  if (isMobile) {
    return (
      <MobileOverlayPanel
        open={open}
        onClose={() => onOpenChange(false)}
        title="Add project directory"
        className="max-w-full"
        contentMaxHeightClassName="max-h-[min(70vh,520px)] h-[min(70vh,520px)]"
        footer={<div className="flex flex-row gap-2">{renderActionButtons()}</div>}
      >
        {mobileContent}
      </MobileOverlayPanel>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex w-full max-w-[min(560px,100vw)] max-h-[calc(100vh-32px)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[80vh] sm:max-w-xl sm:p-6'
        )}
        onOpenAutoFocus={(e) => {
          // Prevent auto-focus on input to avoid text selection
          e.preventDefault();
        }}
      >
        {dialogHeader}
        {desktopContent}
        <DialogFooter
          className="sticky bottom-0 flex w-full flex-shrink-0 flex-row gap-2 border-t border-border/40 bg-sidebar px-4 py-3 sm:static sm:justify-end sm:border-0 sm:bg-transparent sm:px-0 sm:pt-4 sm:pb-0"
        >
          {renderActionButtons()}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
