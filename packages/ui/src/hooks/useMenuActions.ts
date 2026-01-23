import React from 'react';
import { toast } from '@/components/ui';
import { useChatStore } from '@/stores/useChatStore';
import { useUIStore } from '@/stores/useUIStore';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { sessionEvents } from '@/lib/sessionEvents';
import { createWorktreeSession } from '@/lib/worktreeSessionCreator';
import { useDirectoryStore } from '@/stores/useDirectoryStore';

const MENU_ACTION_EVENT = 'openchamber:menu-action';

type MenuAction =
  | 'about'
  | 'settings'
  | 'command-palette'
  | 'new-session'
  | 'new-worktree-session'
  | 'change-workspace'
  | 'open-git-tab'
  | 'open-diff-tab'
  | 'open-terminal-tab'
  | 'theme-light'
  | 'theme-dark'
  | 'theme-system'
  | 'toggle-sidebar'
  | 'toggle-memory-debug'
  | 'help-dialog'
  | 'download-logs';

export const useMenuActions = () => {
  const { createAndLoadSession } = useChatStore();
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const {
    toggleCommandPalette,
    toggleHelpDialog,
    toggleSidebar,
    setSessionSwitcherOpen,
    setActiveMainTab,
    setSettingsDialogOpen,
    setAboutDialogOpen,
  } = useUIStore();
  const { setThemeMode } = useThemeSystem();
  const isDownloadingLogsRef = React.useRef(false);

  const handleChangeWorkspace = React.useCallback(() => {
    sessionEvents.requestDirectoryDialog();
  }, []);

  React.useEffect(() => {
    const handleMenuAction = (event: Event) => {
      const action = (event as CustomEvent<MenuAction>).detail;

      switch (action) {
        case 'about':
          setAboutDialogOpen(true);
          break;

        case 'settings':
          setSettingsDialogOpen(true);
          break;

        case 'command-palette':
          toggleCommandPalette();
          break;

        case 'new-session':
          setActiveMainTab('chat');
          setSessionSwitcherOpen(false);
          if (currentDirectory) {
            void createAndLoadSession(currentDirectory);
          }
          break;

        case 'new-worktree-session':
          setActiveMainTab('chat');
          setSessionSwitcherOpen(false);
          createWorktreeSession();
          break;

        case 'change-workspace':
          handleChangeWorkspace();
          break;

        case 'open-git-tab': {
          const { activeMainTab } = useUIStore.getState();
          setActiveMainTab(activeMainTab === 'git' ? 'chat' : 'git');
          break;
        }

        case 'open-diff-tab': {
          const { activeMainTab } = useUIStore.getState();
          setActiveMainTab(activeMainTab === 'diff' ? 'chat' : 'diff');
          break;
        }

        case 'open-terminal-tab': {
          const { activeMainTab } = useUIStore.getState();
          setActiveMainTab(activeMainTab === 'terminal' ? 'chat' : 'terminal');
          break;
        }

        case 'theme-light':
          setThemeMode('light');
          break;

        case 'theme-dark':
          setThemeMode('dark');
          break;

        case 'theme-system':
          setThemeMode('system');
          break;

        case 'toggle-sidebar':
          toggleSidebar();
          break;

        case 'toggle-memory-debug':
          break;

        case 'help-dialog':
          toggleHelpDialog();
          break;

        case 'download-logs': {
          const runtimeAPIs = getRegisteredRuntimeAPIs();
          const diagnostics = runtimeAPIs?.diagnostics;
          if (!diagnostics || isDownloadingLogsRef.current) {
            break;
          }

          isDownloadingLogsRef.current = true;
          diagnostics
            .downloadLogs()
            .then(({ fileName, content }) => {
              const finalFileName = fileName || 'openchamber.log';
              const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = finalFileName;
              document.body.appendChild(anchor);
              anchor.click();
              document.body.removeChild(anchor);
              URL.revokeObjectURL(url);
              toast.success('Logs saved', {
                description: `Downloaded to ~/Downloads/${finalFileName}`,
              });
            })
            .catch(() => {
              toast.error('Failed to download logs');
            })
            .finally(() => {
              isDownloadingLogsRef.current = false;
            });
          break;
        }
      }
    };

    window.addEventListener(MENU_ACTION_EVENT, handleMenuAction);
    return () => window.removeEventListener(MENU_ACTION_EVENT, handleMenuAction);
  }, [
    createAndLoadSession,
    currentDirectory,
    toggleCommandPalette,
    toggleHelpDialog,
    toggleSidebar,
    setSessionSwitcherOpen,
    setActiveMainTab,
    setSettingsDialogOpen,
    setAboutDialogOpen,
    setThemeMode,
    handleChangeWorkspace,
  ]);
};
