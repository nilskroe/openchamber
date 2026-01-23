import { useEffect } from 'react';
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { useUIStore } from './useUIStore';
import { type PaneTabType, getTabLabel } from '@/constants/tabs';

export type { PaneTabType } from '@/constants/tabs';
export type PaneId = 'left' | 'right' | 'rightBottom';

export interface PaneTab {
  id: string;
  type: PaneTabType;
  title: string;
  sessionId?: string;
  filePath?: string;
  url?: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

interface PaneState {
  tabs: PaneTab[];
  activeTabId: string | null;
}

interface PaneStoreState {
  panesByWorktree: Map<string, { left: PaneState; right: PaneState; rightBottom: PaneState }>;
  rightPaneVisible: boolean;
  rightPaneWidth: number;
  rightBottomHeight: number;
  rightBottomCollapsed: boolean;
  focusedPane: PaneId;
}

interface PaneStoreActions {
  getPaneState: (worktreeId: string, paneId: PaneId) => PaneState;
  setFocusedPane: (paneId: PaneId) => void;
  toggleRightPane: () => void;
  setRightPaneWidth: (width: number) => void;
  setRightBottomHeight: (height: number) => void;
  setRightBottomCollapsed: (collapsed: boolean) => void;
  toggleRightBottomCollapsed: () => void;
  initializeWorktree: (worktreeId: string) => void;
  
  addTab: (worktreeId: string, paneId: PaneId, tab: Omit<PaneTab, 'id' | 'createdAt'>) => string;
  closeTab: (worktreeId: string, paneId: PaneId, tabId: string) => void;
  setActiveTab: (worktreeId: string, paneId: PaneId, tabId: string) => void;
  updateTabTitle: (worktreeId: string, paneId: PaneId, tabId: string, title: string) => void;
  updateTabMetadata: (worktreeId: string, paneId: PaneId, tabId: string, metadata: Record<string, unknown>) => void;
  
  moveTab: (worktreeId: string, sourcePane: PaneId, targetPane: PaneId, tabId: string, targetIndex?: number) => void;
  reorderTabs: (worktreeId: string, paneId: PaneId, sourceId: string, targetId: string) => void;
  
  openChatSession: (worktreeId: string, paneId: PaneId, sessionId: string, title?: string) => string;
  findTabBySessionId: (worktreeId: string, sessionId: string) => { paneId: PaneId; tab: PaneTab } | null;
  
  activateTabByIndex: (worktreeId: string, index: number) => void;
  closeActiveTab: (worktreeId: string) => void;
}

type PaneStore = PaneStoreState & PaneStoreActions;

const EMPTY_PANE_STATE: PaneState = {
  tabs: [],
  activeTabId: null,
};

const generateTabId = (type: PaneTabType): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${type}-${timestamp}-${random}`;
};

const createDefaultTabs = (tabTypes?: PaneTabType[]): PaneTab[] => {
  const types = tabTypes ?? useUIStore.getState().defaultLeftPaneTabs;
  const now = Date.now();
  return types.map((type, index) => ({
    id: generateTabId(type),
    type,
    title: getTabLabel(type),
    createdAt: now + index,
  }));
};

const createDefaultRightTabs = (): PaneTab[] => {
  const types = useUIStore.getState().defaultRightPaneTabs;
  const now = Date.now();
  return types.map((type, index) => ({
    id: generateTabId(type),
    type,
    title: getTabLabel(type),
    createdAt: now + index,
  }));
};

const ensureWorktreePanes = (
  panesByWorktree: Map<string, { left: PaneState; right: PaneState; rightBottom: PaneState }>,
  worktreeId: string
): { left: PaneState; right: PaneState; rightBottom: PaneState } => {
  let panes = panesByWorktree.get(worktreeId);
  if (!panes) {
    const leftTabs = createDefaultTabs();
    const rightTabs = createDefaultRightTabs();
    panes = {
      left: { tabs: leftTabs, activeTabId: leftTabs[0]?.id ?? null },
      right: { tabs: rightTabs, activeTabId: rightTabs[0]?.id ?? null },
      rightBottom: { tabs: [], activeTabId: null },
    };
    panesByWorktree.set(worktreeId, panes);
  }
  return panes;
};

export const usePaneStore = create<PaneStore>()(
  devtools(
    persist(
      (set, get) => ({
        panesByWorktree: new Map(),
        rightPaneVisible: true,
        rightPaneWidth: 400,
        rightBottomHeight: 250,
        rightBottomCollapsed: true,
        focusedPane: 'left',
        
        getPaneState: (worktreeId: string, paneId: PaneId) => {
          const panes = get().panesByWorktree.get(worktreeId);
          if (!panes) return EMPTY_PANE_STATE;
          return panes[paneId];
        },
        
        setFocusedPane: (paneId: PaneId) => {
          set({ focusedPane: paneId });
        },
        
        toggleRightPane: () => {
          set((state) => ({ rightPaneVisible: !state.rightPaneVisible }));
        },
        
        setRightPaneWidth: (width: number) => {
          const maxWidth = typeof window !== 'undefined' ? Math.floor(window.innerWidth * 0.6) : 800;
          set({ rightPaneWidth: Math.max(280, Math.min(maxWidth, width)) });
        },
        
        setRightBottomHeight: (height: number) => {
          const MIN_HEIGHT = 100;
          const maxHeight = typeof window !== 'undefined' ? Math.floor(window.innerHeight * 0.7) : 600;
          set({ rightBottomHeight: Math.max(MIN_HEIGHT, Math.min(maxHeight, height)) });
        },
        
        setRightBottomCollapsed: (collapsed: boolean) => {
          set({ rightBottomCollapsed: collapsed });
        },
        
        toggleRightBottomCollapsed: () => {
          set((state) => ({ rightBottomCollapsed: !state.rightBottomCollapsed }));
        },
        
        initializeWorktree: (worktreeId: string) => {
          const existing = get().panesByWorktree.get(worktreeId);
          if (existing) return;
          
          set((state) => {
            const panesByWorktree = new Map(state.panesByWorktree);
            ensureWorktreePanes(panesByWorktree, worktreeId);
            return { panesByWorktree };
          });
        },
        
        addTab: (worktreeId: string, paneId: PaneId, tabData: Omit<PaneTab, 'id' | 'createdAt'>) => {
          const id = generateTabId(tabData.type);
          const tab: PaneTab = {
            ...tabData,
            id,
            createdAt: Date.now(),
          };
          
          set((state) => {
            const panesByWorktree = new Map(state.panesByWorktree);
            const panes = ensureWorktreePanes(panesByWorktree, worktreeId);
            const paneState = panes[paneId];
            
            panes[paneId] = {
              tabs: [...paneState.tabs, tab],
              activeTabId: id,
            };
            
            return { panesByWorktree };
          });
          
          return id;
        },
        
        closeTab: (worktreeId: string, paneId: PaneId, tabId: string) => {
          const panes = get().panesByWorktree.get(worktreeId);
          if (!panes) return;

          const paneState = panes[paneId];
          const tabIndex = paneState.tabs.findIndex((t) => t.id === tabId);
          if (tabIndex === -1) return;

          // Chat and appRunner tabs are non-closable
          const tab = paneState.tabs[tabIndex];
          if (tab.type === 'chat' || tab.type === 'appRunner') return;
          
          const newTabs = paneState.tabs.filter((t) => t.id !== tabId);
          let newActiveTabId = paneState.activeTabId;
          let newActiveTab: PaneTab | undefined;
          
          if (paneState.activeTabId === tabId) {
            if (newTabs.length > 0) {
              newActiveTab = newTabs[Math.min(tabIndex, newTabs.length - 1)];
              newActiveTabId = newActiveTab.id;
            } else {
              newActiveTabId = null;
            }
          }
          
          set((state) => {
            const panesByWorktree = new Map(state.panesByWorktree);
            const currentPanes = panesByWorktree.get(worktreeId);
            if (!currentPanes) return state;
            
            currentPanes[paneId] = {
              tabs: newTabs,
              activeTabId: newActiveTabId,
            };
            
            return { panesByWorktree };
          });
          
          // Session is determined by worktree directory, not tab switching
        },
        
        setActiveTab: (worktreeId: string, paneId: PaneId, tabId: string) => {
          set((state) => {
            const panesByWorktree = new Map(state.panesByWorktree);
            const panes = panesByWorktree.get(worktreeId);
            if (!panes) return state;
            
            const paneState = panes[paneId];
            const tab = paneState.tabs.find((t) => t.id === tabId);
            if (!tab) return state;
            
            panes[paneId] = {
              ...paneState,
              activeTabId: tabId,
            };
            
            return { panesByWorktree, focusedPane: paneId };
          });
        },
        
        updateTabTitle: (worktreeId: string, paneId: PaneId, tabId: string, title: string) => {
          set((state) => {
            const panesByWorktree = new Map(state.panesByWorktree);
            const panes = panesByWorktree.get(worktreeId);
            if (!panes) return state;
            
            const paneState = panes[paneId];
            panes[paneId] = {
              ...paneState,
              tabs: paneState.tabs.map((t) =>
                t.id === tabId ? { ...t, title } : t
              ),
            };
            
            return { panesByWorktree };
          });
        },
        
        updateTabMetadata: (worktreeId: string, paneId: PaneId, tabId: string, metadata: Record<string, unknown>) => {
          set((state) => {
            const panesByWorktree = new Map(state.panesByWorktree);
            const panes = panesByWorktree.get(worktreeId);
            if (!panes) return state;
            
            const paneState = panes[paneId];
            panes[paneId] = {
              ...paneState,
              tabs: paneState.tabs.map((t) =>
                t.id === tabId ? { ...t, metadata: { ...t.metadata, ...metadata } } : t
              ),
            };
            
            return { panesByWorktree };
          });
        },
        
        moveTab: (worktreeId: string, sourcePane: PaneId, targetPane: PaneId, tabId: string, targetIndex?: number) => {
          set((state) => {
            const panesByWorktree = new Map(state.panesByWorktree);
            const existingPanes = panesByWorktree.get(worktreeId);
            if (!existingPanes) return state;
            
            const sourceState = existingPanes[sourcePane];
            const tabIndex = sourceState.tabs.findIndex((t) => t.id === tabId);
            if (tabIndex === -1) return state;
            
            const tab = sourceState.tabs[tabIndex];
            const newSourceTabs = sourceState.tabs.filter((t) => t.id !== tabId);
            
            let newSourceActiveTabId = sourceState.activeTabId;
            if (sourceState.activeTabId === tabId) {
              if (newSourceTabs.length > 0) {
                newSourceActiveTabId = newSourceTabs[Math.min(tabIndex, newSourceTabs.length - 1)].id;
              } else {
                newSourceActiveTabId = null;
              }
            }
            
            const targetState = existingPanes[targetPane];
            let newTargetTabs: PaneTab[];
            if (typeof targetIndex === 'number') {
              newTargetTabs = [...targetState.tabs.slice(0, targetIndex), tab, ...targetState.tabs.slice(targetIndex)];
            } else {
              newTargetTabs = [...targetState.tabs, tab];
            }
            
            const newPanes = {
              ...existingPanes,
              [sourcePane]: { tabs: newSourceTabs, activeTabId: newSourceActiveTabId },
              [targetPane]: { tabs: newTargetTabs, activeTabId: tabId },
            };
            
            panesByWorktree.set(worktreeId, newPanes);
            
            return { panesByWorktree, focusedPane: targetPane };
          });
        },
        
        reorderTabs: (worktreeId: string, paneId: PaneId, sourceId: string, targetId: string) => {
          set((state) => {
            const panesByWorktree = new Map(state.panesByWorktree);
            const existingPanes = panesByWorktree.get(worktreeId);
            if (!existingPanes) return state;
            
            const paneState = existingPanes[paneId];
            const sourceIndex = paneState.tabs.findIndex((t) => t.id === sourceId);
            const targetIndex = paneState.tabs.findIndex((t) => t.id === targetId);
            if (sourceIndex === -1 || targetIndex === -1) return state;
            
            const tabs = [...paneState.tabs];
            const [moved] = tabs.splice(sourceIndex, 1);
            tabs.splice(targetIndex, 0, moved);
            
            const newPanes = {
              ...existingPanes,
              [paneId]: { ...paneState, tabs },
            };
            panesByWorktree.set(worktreeId, newPanes);
            
            return { panesByWorktree };
          });
        },
        
        openChatSession: (worktreeId: string, paneId: PaneId, sessionId: string, title?: string) => {
          const { findTabBySessionId, setActiveTab, addTab } = get();

          const existing = findTabBySessionId(worktreeId, sessionId);
          if (existing) {
            setActiveTab(worktreeId, existing.paneId, existing.tab.id);
            return existing.tab.id;
          }

          const tabId = addTab(worktreeId, paneId, {
            type: 'chat',
            title: title ?? 'Chat',
            sessionId,
          });
          return tabId;
        },
        
        findTabBySessionId: (worktreeId: string, sessionId: string) => {
          const panes = get().panesByWorktree.get(worktreeId);
          if (!panes) return null;
          
          for (const paneId of ['left', 'right', 'rightBottom'] as PaneId[]) {
            const tab = panes[paneId].tabs.find(
              (t) => t.type === 'chat' && t.sessionId === sessionId
            );
            if (tab) {
              return { paneId, tab };
            }
          }
          
          return null;
        },
        
        activateTabByIndex: (worktreeId: string, index: number) => {
          const { focusedPane, panesByWorktree, setActiveTab } = get();
          const panes = panesByWorktree.get(worktreeId);
          if (!panes) return;

          const paneState = panes[focusedPane];
          if (index >= 0 && index < paneState.tabs.length) {
            const tab = paneState.tabs[index];
            setActiveTab(worktreeId, focusedPane, tab.id);
          }
        },
        
        closeActiveTab: (worktreeId: string) => {
          const { focusedPane, panesByWorktree, closeTab } = get();
          const panes = panesByWorktree.get(worktreeId);
          if (!panes) return;

          const paneState = panes[focusedPane];
          if (paneState.activeTabId) {
            const activeTab = paneState.tabs.find((t) => t.id === paneState.activeTabId);
            if (activeTab && (activeTab.type === 'chat' || activeTab.type === 'appRunner')) return;
            closeTab(worktreeId, focusedPane, paneState.activeTabId);
          }
        },
      }),
      {
        name: 'openchamber-pane-store',
        partialize: (state) => ({
          panesByWorktree: Object.fromEntries(state.panesByWorktree),
          rightPaneVisible: state.rightPaneVisible,
          rightPaneWidth: state.rightPaneWidth,
          rightBottomHeight: state.rightBottomHeight,
          rightBottomCollapsed: state.rightBottomCollapsed,
        }),
        merge: (persisted, current) => {
          const persistedState = persisted as {
            panesByWorktree?: Record<string, { left: PaneState; right: PaneState; rightBottom?: PaneState }>;
            rightPaneVisible?: boolean;
            rightPaneWidth?: number;
            rightBottomHeight?: number;
            rightBottomCollapsed?: boolean;
          };
          
          const migratedPanes = Object.entries(persistedState.panesByWorktree ?? {}).map(([key, value]) => {
            const panes = value;
            if (!panes.rightBottom) {
              panes.rightBottom = { tabs: [], activeTabId: null };
            }
            return [key, panes] as [string, { left: PaneState; right: PaneState; rightBottom: PaneState }];
          });
          
          return {
            ...current,
            panesByWorktree: new Map(migratedPanes),
            rightPaneVisible: persistedState.rightPaneVisible ?? true,
            rightPaneWidth: persistedState.rightPaneWidth ?? 400,
            rightBottomHeight: persistedState.rightBottomHeight ?? 250,
            rightBottomCollapsed: persistedState.rightBottomCollapsed ?? true,
          };
        },
      }
    ),
    { name: 'pane-store' }
  )
);

export function usePanes(worktreeId: string | null) {
  const resolvedId = worktreeId ?? 'global';
  
  const initializeWorktree = usePaneStore((state) => state.initializeWorktree);
  
  useEffect(() => {
    initializeWorktree(resolvedId);
  }, [resolvedId, initializeWorktree]);
  
  const leftPane = usePaneStore((state) => {
    const panes = state.panesByWorktree.get(resolvedId);
    return panes?.left ?? EMPTY_PANE_STATE;
  });
  
  const rightPane = usePaneStore((state) => {
    const panes = state.panesByWorktree.get(resolvedId);
    return panes?.right ?? EMPTY_PANE_STATE;
  });
  
  const rightBottomPane = usePaneStore((state) => {
    const panes = state.panesByWorktree.get(resolvedId);
    return panes?.rightBottom ?? EMPTY_PANE_STATE;
  });
  
  const focusedPane = usePaneStore((state) => state.focusedPane);
  const rightPaneVisible = usePaneStore((state) => state.rightPaneVisible);
  const rightPaneWidth = usePaneStore((state) => state.rightPaneWidth);
  const rightBottomHeight = usePaneStore((state) => state.rightBottomHeight);
  const rightBottomCollapsed = usePaneStore((state) => state.rightBottomCollapsed);
  
  const setFocusedPane = usePaneStore((state) => state.setFocusedPane);
  const toggleRightPane = usePaneStore((state) => state.toggleRightPane);
  const setRightPaneWidth = usePaneStore((state) => state.setRightPaneWidth);
  const setRightBottomHeight = usePaneStore((state) => state.setRightBottomHeight);
  const setRightBottomCollapsed = usePaneStore((state) => state.setRightBottomCollapsed);
  const toggleRightBottomCollapsed = usePaneStore((state) => state.toggleRightBottomCollapsed);
  const addTabStore = usePaneStore((state) => state.addTab);
  const closeTabStore = usePaneStore((state) => state.closeTab);
  const setActiveTabStore = usePaneStore((state) => state.setActiveTab);
  const updateTabTitleStore = usePaneStore((state) => state.updateTabTitle);
  const updateTabMetadataStore = usePaneStore((state) => state.updateTabMetadata);
  const moveTabStore = usePaneStore((state) => state.moveTab);
  const reorderTabsStore = usePaneStore((state) => state.reorderTabs);
  const openChatSessionStore = usePaneStore((state) => state.openChatSession);
  const findTabBySessionIdStore = usePaneStore((state) => state.findTabBySessionId);
  const activateTabByIndexStore = usePaneStore((state) => state.activateTabByIndex);
  const closeActiveTabStore = usePaneStore((state) => state.closeActiveTab);
  
  return {
    leftPane,
    rightPane,
    rightBottomPane,
    focusedPane,
    rightPaneVisible,
    rightPaneWidth,
    rightBottomHeight,
    rightBottomCollapsed,
    
    setFocusedPane,
    toggleRightPane,
    setRightPaneWidth,
    setRightBottomHeight,
    setRightBottomCollapsed,
    toggleRightBottomCollapsed,
    
    addTab: (paneId: PaneId, tab: Omit<PaneTab, 'id' | 'createdAt'>) => 
      addTabStore(resolvedId, paneId, tab),
    closeTab: (paneId: PaneId, tabId: string) => 
      closeTabStore(resolvedId, paneId, tabId),
    setActiveTab: (paneId: PaneId, tabId: string) => 
      setActiveTabStore(resolvedId, paneId, tabId),
    updateTabTitle: (paneId: PaneId, tabId: string, title: string) => 
      updateTabTitleStore(resolvedId, paneId, tabId, title),
    updateTabMetadata: (paneId: PaneId, tabId: string, metadata: Record<string, unknown>) => 
      updateTabMetadataStore(resolvedId, paneId, tabId, metadata),
    moveTab: (sourcePane: PaneId, targetPane: PaneId, tabId: string, targetIndex?: number) => 
      moveTabStore(resolvedId, sourcePane, targetPane, tabId, targetIndex),
    reorderTabs: (paneId: PaneId, sourceId: string, targetId: string) => 
      reorderTabsStore(resolvedId, paneId, sourceId, targetId),
    openChatSession: (paneId: PaneId, sessionId: string, title?: string) => 
      openChatSessionStore(resolvedId, paneId, sessionId, title),
    findTabBySessionId: (sessionId: string) => 
      findTabBySessionIdStore(resolvedId, sessionId),
    activateTabByIndex: (index: number) => 
      activateTabByIndexStore(resolvedId, index),
    closeActiveTab: () => 
      closeActiveTabStore(resolvedId),
  };
}
