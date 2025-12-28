import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { useUIStore } from '@/stores/useUIStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { useDeviceInfo } from '@/lib/device';
import { RiAddLine, RiChatAi3Line, RiCheckLine, RiCodeLine, RiComputerLine, RiGitBranchLine, RiLayoutLeftLine, RiMoonLine, RiQuestionLine, RiRestartLine, RiSettings3Line, RiSunLine, RiTerminalBoxLine } from '@remixicon/react';
import { reloadOpenCodeConfiguration } from '@/stores/useAgentsStore';

export const CommandPalette: React.FC = () => {
  const { t } = useTranslation('ui');

  const {
    isCommandPaletteOpen,
    setCommandPaletteOpen,
    setHelpDialogOpen,
    setSessionCreateDialogOpen,
    setActiveMainTab,
    setSettingsDialogOpen,
    setSessionSwitcherOpen,
    toggleSidebar,
  } = useUIStore();

  const {
    openNewSessionDraft,
    setCurrentSession,
    getSessionsByDirectory,
  } = useSessionStore();

  const { currentDirectory } = useDirectoryStore();
  const { themeMode, setThemeMode } = useThemeSystem();

  const handleClose = () => {
    setCommandPaletteOpen(false);
  };

  const handleCreateSession = async () => {
    setActiveMainTab('chat');
    setSessionSwitcherOpen(false);
    openNewSessionDraft();
    handleClose();
  };

  const handleOpenSession = (sessionId: string) => {
    setCurrentSession(sessionId);
    handleClose();
  };

  const handleSetThemeMode = (mode: 'light' | 'dark' | 'system') => {
    setThemeMode(mode);
    handleClose();
  };

  const handleShowHelp = () => {
    setHelpDialogOpen(true);
    handleClose();
  };

  const handleOpenAdvancedSession = () => {
    setSessionCreateDialogOpen(true);
    handleClose();
  };

  const { isMobile } = useDeviceInfo();

  const handleOpenSessionList = () => {
    if (isMobile) {
      const { isSessionSwitcherOpen } = useUIStore.getState();
      setSessionSwitcherOpen(!isSessionSwitcherOpen);
    } else {
      toggleSidebar();
    }
    handleClose();
  };

  const handleOpenDiffPanel = () => {
    setActiveMainTab('diff');
    handleClose();
  };

  const handleOpenGitPanel = () => {
    setActiveMainTab('git');
    handleClose();
  };

  const handleOpenTerminal = () => {
    setActiveMainTab('terminal');
    handleClose();
  };

  const handleOpenSettings = () => {
    setSettingsDialogOpen(true);
    handleClose();
  };

  const handleReloadConfiguration = () => {
    reloadOpenCodeConfiguration();
    handleClose();
  };

  const directorySessions = getSessionsByDirectory(currentDirectory ?? '');
  const currentSessions = React.useMemo(() => {
    return directorySessions.slice(0, 5);
  }, [directorySessions]);

  return (
    <CommandDialog open={isCommandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <CommandInput placeholder={t('commandPalette.placeholder', 'Type a command or search...')} />
      <CommandList>
        <CommandEmpty>{t('commandPalette.noResults', 'No results found.')}</CommandEmpty>

        <CommandGroup heading={t('commandPalette.groups.actions', 'Actions')}>
          <CommandItem onSelect={handleOpenSessionList}>
            <RiLayoutLeftLine className="mr-2 h-4 w-4" />
            <span>{t('commandPalette.actions.openSessionList', 'Open Session List')}</span>
            <CommandShortcut>Ctrl + L</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={handleCreateSession}>
            <RiAddLine className="mr-2 h-4 w-4" />
            <span>{t('commandPalette.actions.newSession', 'New Session')}</span>
            <CommandShortcut>Ctrl + N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={handleOpenAdvancedSession}>
            <RiGitBranchLine className="mr-2 h-4 w-4" />
            <span>{t('commandPalette.actions.newSessionWorktree', 'New Session with Worktree')}</span>
            <CommandShortcut>Shift + Ctrl + N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={handleShowHelp}>
            <RiQuestionLine className="mr-2 h-4 w-4" />
            <span>{t('commandPalette.actions.keyboardShortcuts', 'Keyboard Shortcuts')}</span>
            <CommandShortcut>Ctrl + H</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={handleOpenDiffPanel}>
            <RiCodeLine className="mr-2 h-4 w-4" />
            <span>{t('commandPalette.actions.openDiffPanel', 'Open Diff Panel')}</span>
            <CommandShortcut>Ctrl + E</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={handleOpenGitPanel}>
            <RiGitBranchLine className="mr-2 h-4 w-4" />
            <span>{t('commandPalette.actions.openGitPanel', 'Open Git Panel')}</span>
            <CommandShortcut>Ctrl + G</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={handleOpenTerminal}>
            <RiTerminalBoxLine className="mr-2 h-4 w-4" />
            <span>{t('commandPalette.actions.openTerminal', 'Open Terminal')}</span>
            <CommandShortcut>Ctrl + T</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={handleOpenSettings}>
            <RiSettings3Line className="mr-2 h-4 w-4" />
            <span>{t('commandPalette.actions.openSettings', 'Open Settings')}</span>
            <CommandShortcut>Ctrl + ,</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={handleReloadConfiguration}>
            <RiRestartLine className="mr-2 h-4 w-4" />
            <span>{t('commandPalette.actions.reloadConfig', 'Reload OpenCode Configuration')}</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t('commandPalette.groups.theme', 'Theme')}>
          <CommandItem onSelect={() => handleSetThemeMode('light')}>
            <RiSunLine className="mr-2 h-4 w-4" />
            <span>{t('commandPalette.theme.light', 'Light Theme')}</span>
            {themeMode === 'light' && <RiCheckLine className="ml-auto h-4 w-4" />}
          </CommandItem>
          <CommandItem onSelect={() => handleSetThemeMode('dark')}>
            <RiMoonLine className="mr-2 h-4 w-4" />
            <span>{t('commandPalette.theme.dark', 'Dark Theme')}</span>
            {themeMode === 'dark' && <RiCheckLine className="ml-auto h-4 w-4" />}
          </CommandItem>
          <CommandItem onSelect={() => handleSetThemeMode('system')}>
            <RiComputerLine className="mr-2 h-4 w-4" />
            <span>{t('commandPalette.theme.system', 'System Theme')}</span>
            {themeMode === 'system' && <RiCheckLine className="ml-auto h-4 w-4" />}
          </CommandItem>
        </CommandGroup>

        {currentSessions.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t('commandPalette.groups.recentSessions', 'Recent Sessions')}>
              {currentSessions.map((session) => (
                <CommandItem
                  key={session.id}
                  onSelect={() => handleOpenSession(session.id)}
                >
                  <RiChatAi3Line className="mr-2 h-4 w-4" />
                  <span className="truncate">
                    {session.title || t('chat:session.untitled', 'Untitled Session')}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {}
      </CommandList>
    </CommandDialog>
  );
};
