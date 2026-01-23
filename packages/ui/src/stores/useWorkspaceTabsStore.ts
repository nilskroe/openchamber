import { create } from 'zustand';
import { devtools, persist, createJSONStorage } from 'zustand/middleware';
import { settingsFileStorage } from '@/lib/settingsStorage';

export type WorkspaceTabType = 'chat' | 'file' | 'terminal';

export interface WorkspaceTab {
  id: string;
  type: WorkspaceTabType;
  title: string;
  createdAt: number;
  sessionId?: string;
  path?: string;
  cwd?: string;
  readOnly?: boolean;
  unclosable?: boolean;
  metadata?: Record<string, unknown>;
}

interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  history: WorkspaceTab[];
}

interface WorkspaceTabsStore {
  workspaces: Map<string, WorkspaceState>;
  rightSidebarCollapsed: boolean;
  rightSidebarWidth: number;
  terminalPanelCollapsed: boolean;
  
  getWorkspace: (workspaceId: string) => WorkspaceState;
  createTab: (workspaceId: string, tab: Omit<WorkspaceTab, 'id' | 'createdAt'>) => string;
  closeTab: (workspaceId: string, tabId: string) => void;
  setActiveTab: (workspaceId: string, tabId: string) => void;
  updateTabTitle: (workspaceId: string, tabId: string, title: string) => void;
  updateTabMetadata: (workspaceId: string, tabId: string, metadata: Record<string, unknown>) => void;
  reorderTabs: (workspaceId: string, sourceId: string, targetId: string) => void;
  restoreFromHistory: (workspaceId: string, tabId: string) => void;
  
  openChat: (workspaceId: string, sessionId: string, title?: string) => string;
  openFile: (workspaceId: string, filePath: string) => string;
  openTerminal: (workspaceId: string, cwd?: string, title?: string) => string;
  
  findTabBySessionId: (workspaceId: string, sessionId: string) => WorkspaceTab | null;
  findTabByFilePath: (workspaceId: string, filePath: string) => WorkspaceTab | null;
  
  setRightSidebarCollapsed: (collapsed: boolean) => void;
  setRightSidebarWidth: (width: number) => void;
  setTerminalPanelCollapsed: (collapsed: boolean) => void;
  toggleRightSidebar: () => void;
  toggleTerminalPanel: () => void;
}

const EMPTY_WORKSPACE: WorkspaceState = {
  tabs: [],
  activeTabId: null,
  history: [],
};

const generateTabId = (type: WorkspaceTabType): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${type}-${timestamp}-${random}`;
};

export const useWorkspaceTabsStore = create<WorkspaceTabsStore>()(
  devtools(
    persist(
      (set, get) => ({
        workspaces: new Map(),
        rightSidebarCollapsed: false,
        rightSidebarWidth: 320,
        terminalPanelCollapsed: false,
        
        getWorkspace: (workspaceId: string) => {
          const workspace = get().workspaces.get(workspaceId);
          return workspace ?? EMPTY_WORKSPACE;
        },
        
        createTab: (workspaceId: string, tabData: Omit<WorkspaceTab, 'id' | 'createdAt'>) => {
          const id = generateTabId(tabData.type);
          const tab: WorkspaceTab = {
            ...tabData,
            id,
            createdAt: Date.now(),
          };
          
          set((state) => {
            const workspaces = new Map(state.workspaces);
            const workspace = workspaces.get(workspaceId) ?? { ...EMPTY_WORKSPACE };
            
            workspaces.set(workspaceId, {
              ...workspace,
              tabs: [...workspace.tabs, tab],
              activeTabId: id,
            });
            
            return { workspaces };
          });
          
          return id;
        },
        
        closeTab: (workspaceId: string, tabId: string) => {
          set((state) => {
            const workspaces = new Map(state.workspaces);
            const workspace = workspaces.get(workspaceId);
            if (!workspace) return state;
            
            const tabIndex = workspace.tabs.findIndex(t => t.id === tabId);
            if (tabIndex === -1) return state;
            
            const tab = workspace.tabs[tabIndex];
            if (tab.unclosable) return state;
            
            const newTabs = workspace.tabs.filter(t => t.id !== tabId);
            const newHistory = [tab, ...workspace.history].slice(0, 20);
            
            let newActiveTabId = workspace.activeTabId;
            if (workspace.activeTabId === tabId) {
              if (newTabs.length > 0) {
                const nextTab = newTabs[Math.min(tabIndex, newTabs.length - 1)];
                newActiveTabId = nextTab.id;
              } else {
                newActiveTabId = null;
              }
            }
            
            workspaces.set(workspaceId, {
              tabs: newTabs,
              activeTabId: newActiveTabId,
              history: newHistory,
            });
            
            return { workspaces };
          });
        },
        
        setActiveTab: (workspaceId: string, tabId: string) => {
          set((state) => {
            const workspaces = new Map(state.workspaces);
            const workspace = workspaces.get(workspaceId);
            if (!workspace) return state;
            
            const tab = workspace.tabs.find(t => t.id === tabId);
            if (!tab) return state;
            
            workspaces.set(workspaceId, {
              ...workspace,
              activeTabId: tabId,
            });
            
            return { workspaces };
          });
        },
        
        updateTabTitle: (workspaceId: string, tabId: string, title: string) => {
          set((state) => {
            const workspaces = new Map(state.workspaces);
            const workspace = workspaces.get(workspaceId);
            if (!workspace) return state;
            
            const tabs = workspace.tabs.map(t => 
              t.id === tabId ? { ...t, title } : t
            );
            
            workspaces.set(workspaceId, { ...workspace, tabs });
            return { workspaces };
          });
        },
        
        updateTabMetadata: (workspaceId: string, tabId: string, metadata: Record<string, unknown>) => {
          set((state) => {
            const workspaces = new Map(state.workspaces);
            const workspace = workspaces.get(workspaceId);
            if (!workspace) return state;
            
            const tabs = workspace.tabs.map(t => 
              t.id === tabId ? { ...t, metadata: { ...t.metadata, ...metadata } } : t
            );
            
            workspaces.set(workspaceId, { ...workspace, tabs });
            return { workspaces };
          });
        },
        
        reorderTabs: (workspaceId: string, sourceId: string, targetId: string) => {
          set((state) => {
            const workspaces = new Map(state.workspaces);
            const workspace = workspaces.get(workspaceId);
            if (!workspace) return state;
            
            const sourceIndex = workspace.tabs.findIndex(t => t.id === sourceId);
            const targetIndex = workspace.tabs.findIndex(t => t.id === targetId);
            if (sourceIndex === -1 || targetIndex === -1) return state;
            
            const tabs = [...workspace.tabs];
            const [moved] = tabs.splice(sourceIndex, 1);
            tabs.splice(targetIndex, 0, moved);
            
            workspaces.set(workspaceId, { ...workspace, tabs });
            return { workspaces };
          });
        },
        
        restoreFromHistory: (workspaceId: string, tabId: string) => {
          set((state) => {
            const workspaces = new Map(state.workspaces);
            const workspace = workspaces.get(workspaceId);
            if (!workspace) return state;
            
            const historyIndex = workspace.history.findIndex(t => t.id === tabId);
            if (historyIndex === -1) return state;
            
            const [restored] = workspace.history.splice(historyIndex, 1);
            
            workspaces.set(workspaceId, {
              tabs: [...workspace.tabs, restored],
              activeTabId: restored.id,
              history: workspace.history,
            });
            
            return { workspaces };
          });
        },
        
        openChat: (workspaceId: string, sessionId: string, title?: string) => {
          const { findTabBySessionId, setActiveTab, createTab } = get();
          
          const existingTab = findTabBySessionId(workspaceId, sessionId);
          if (existingTab) {
            setActiveTab(workspaceId, existingTab.id);
            return existingTab.id;
          }
          
          return createTab(workspaceId, {
            type: 'chat',
            title: title ?? 'New Chat',
            sessionId,
          });
        },
        
        openFile: (workspaceId: string, filePath: string) => {
          const { findTabByFilePath, setActiveTab, createTab } = get();
          
          const existingTab = findTabByFilePath(workspaceId, filePath);
          if (existingTab) {
            setActiveTab(workspaceId, existingTab.id);
            return existingTab.id;
          }
          
          const fileName = filePath.split('/').pop() ?? filePath;
          
          return createTab(workspaceId, {
            type: 'file',
            title: fileName,
            path: filePath,
          });
        },
        
        openTerminal: (workspaceId: string, cwd?: string, title?: string) => {
          const { getWorkspace, createTab } = get();
          const workspace = getWorkspace(workspaceId);
          
          const terminalCount = workspace.tabs.filter(t => t.type === 'terminal').length;
          
          return createTab(workspaceId, {
            type: 'terminal',
            title: title ?? `Terminal ${terminalCount + 1}`,
            cwd,
          });
        },
        
        findTabBySessionId: (workspaceId: string, sessionId: string) => {
          const workspace = get().workspaces.get(workspaceId);
          if (!workspace) return null;
          return workspace.tabs.find(t => t.type === 'chat' && t.sessionId === sessionId) ?? null;
        },
        
        findTabByFilePath: (workspaceId: string, filePath: string) => {
          const workspace = get().workspaces.get(workspaceId);
          if (!workspace) return null;
          return workspace.tabs.find(t => t.type === 'file' && t.path === filePath) ?? null;
        },
        
        setRightSidebarCollapsed: (collapsed: boolean) => {
          set({ rightSidebarCollapsed: collapsed });
        },
        
        setRightSidebarWidth: (width: number) => {
          set({ rightSidebarWidth: width });
        },
        
        setTerminalPanelCollapsed: (collapsed: boolean) => {
          set({ terminalPanelCollapsed: collapsed });
        },
        
        toggleRightSidebar: () => {
          set((state) => ({ rightSidebarCollapsed: !state.rightSidebarCollapsed }));
        },
        
        toggleTerminalPanel: () => {
          set((state) => ({ terminalPanelCollapsed: !state.terminalPanelCollapsed }));
        },
      }),
      {
        name: 'openchamber-workspace-tabs',
        storage: createJSONStorage(() => settingsFileStorage),
        partialize: (state) => ({
          workspaces: Object.fromEntries(state.workspaces),
          rightSidebarCollapsed: state.rightSidebarCollapsed,
          rightSidebarWidth: state.rightSidebarWidth,
          terminalPanelCollapsed: state.terminalPanelCollapsed,
        }),
        merge: (persisted, current) => {
          const persistedState = persisted as {
            workspaces?: Record<string, WorkspaceState>;
            rightSidebarCollapsed?: boolean;
            rightSidebarWidth?: number;
            terminalPanelCollapsed?: boolean;
          };
          
          return {
            ...current,
            workspaces: new Map(Object.entries(persistedState.workspaces ?? {})),
            rightSidebarCollapsed: persistedState.rightSidebarCollapsed ?? false,
            rightSidebarWidth: persistedState.rightSidebarWidth ?? 320,
            terminalPanelCollapsed: persistedState.terminalPanelCollapsed ?? false,
          };
        },
      }
    ),
    { name: 'workspace-tabs-store' }
  )
);

export function useWorkspaceTabs(workspaceId: string | null) {
  const store = useWorkspaceTabsStore();
  const resolvedId = workspaceId ?? 'global';
  const workspace = store.getWorkspace(resolvedId);
  
  return {
    tabs: workspace.tabs,
    activeTabId: workspace.activeTabId,
    activeTab: workspace.tabs.find(t => t.id === workspace.activeTabId) ?? null,
    history: workspace.history,
    
    createTab: (tab: Omit<WorkspaceTab, 'id' | 'createdAt'>) => store.createTab(resolvedId, tab),
    closeTab: (tabId: string) => store.closeTab(resolvedId, tabId),
    setActiveTab: (tabId: string) => store.setActiveTab(resolvedId, tabId),
    updateTabTitle: (tabId: string, title: string) => store.updateTabTitle(resolvedId, tabId, title),
    updateTabMetadata: (tabId: string, metadata: Record<string, unknown>) => store.updateTabMetadata(resolvedId, tabId, metadata),
    reorderTabs: (sourceId: string, targetId: string) => store.reorderTabs(resolvedId, sourceId, targetId),
    restoreFromHistory: (tabId: string) => store.restoreFromHistory(resolvedId, tabId),
    
    openChat: (sessionId: string, title?: string) => store.openChat(resolvedId, sessionId, title),
    openFile: (filePath: string) => store.openFile(resolvedId, filePath),
    openTerminal: (cwd?: string, title?: string) => store.openTerminal(resolvedId, cwd, title),
    
    findTabBySessionId: (sessionId: string) => store.findTabBySessionId(resolvedId, sessionId),
    findTabByFilePath: (filePath: string) => store.findTabByFilePath(resolvedId, filePath),
  };
}
