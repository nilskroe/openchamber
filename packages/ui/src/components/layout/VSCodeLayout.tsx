import React from 'react';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { ChatView, SettingsView } from '@/components/views';
import { useChatStore } from '@/stores/useChatStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { ContextUsageDisplay } from '@/components/ui/ContextUsageDisplay';
import { McpDropdown } from '@/components/mcp/McpDropdown';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { RiArrowLeftLine, RiRobot2Line, RiSettings3Line } from '@remixicon/react';

// Width threshold for mobile vs desktop layout in settings
const MOBILE_WIDTH_THRESHOLD = 550;

type VSCodeView = 'chat' | 'settings';

export const VSCodeLayout: React.FC = () => {
  const runtimeApis = useRuntimeAPIs();

  const [currentView, setCurrentView] = React.useState<VSCodeView>('chat');
  const [containerWidth, setContainerWidth] = React.useState<number>(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const sessionTitle = useChatStore((state) => state.sessionTitle);
  const loadSession = useChatStore((state) => state.loadSession);

  const activeSessionTitle = sessionTitle || 'Session';
  const [connectionStatus, setConnectionStatus] = React.useState<'connecting' | 'connected' | 'error' | 'disconnected'>(
    () => (typeof window !== 'undefined'
      ? (window as { __OPENCHAMBER_CONNECTION__?: { status?: string } }).__OPENCHAMBER_CONNECTION__?.status as
        'connecting' | 'connected' | 'error' | 'disconnected' | undefined
      : 'connecting') || 'connecting'
  );
  const configInitialized = useConfigStore((state) => state.isInitialized);
  const initializeConfig = useConfigStore((state) => state.initializeApp);
  const [hasInitializedOnce, setHasInitializedOnce] = React.useState<boolean>(() => configInitialized);
  const [isInitializing, setIsInitializing] = React.useState<boolean>(false);
  const lastBootstrapAttemptAt = React.useRef<number>(0);

  React.useEffect(() => {
    const vscodeApi = runtimeApis.vscode;
    if (!vscodeApi) {
      return;
    }

    void vscodeApi.executeCommand('openchamber.setActiveSession', currentSessionId, activeSessionTitle);
  }, [activeSessionTitle, currentSessionId, runtimeApis.vscode]);

  // Listen for connection status changes
  React.useEffect(() => {
    // Catch up with the latest status even if the extension posted the connection message
    // before this component registered the event listener.
    const current =
      (typeof window !== 'undefined'
        ? (window as { __OPENCHAMBER_CONNECTION__?: { status?: string } }).__OPENCHAMBER_CONNECTION__?.status
        : undefined) as 'connecting' | 'connected' | 'error' | 'disconnected' | undefined;
    if (current === 'connected' || current === 'connecting' || current === 'error' || current === 'disconnected') {
      setConnectionStatus(current);
    }

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ status?: string; error?: string }>).detail;
      const status = detail?.status;
      if (status === 'connected' || status === 'connecting' || status === 'error' || status === 'disconnected') {
        setConnectionStatus(status);
      }
    };
    window.addEventListener('openchamber:connection-status', handler as EventListener);
    return () => window.removeEventListener('openchamber:connection-status', handler as EventListener);
  }, []);

  // Listen for navigation events from VS Code extension title bar buttons
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: string }>).detail;
      const view = detail?.view;
      if (view === 'settings') {
        setCurrentView('settings');
      } else if (view === 'chat') {
        setCurrentView('chat');
      }
    };
    window.addEventListener('openchamber:navigate', handler as EventListener);
    return () => window.removeEventListener('openchamber:navigate', handler as EventListener);
  }, []);

  // Bootstrap config and session when connected
  React.useEffect(() => {
    const runBootstrap = async () => {
      if (isInitializing || hasInitializedOnce || connectionStatus !== 'connected') {
        return;
      }
      const now = Date.now();
      if (now - lastBootstrapAttemptAt.current < 750) {
        return;
      }
      lastBootstrapAttemptAt.current = now;
      setIsInitializing(true);
      try {
        const debugEnabled = (() => {
          if (typeof window === 'undefined') return false;
          try {
            return window.localStorage.getItem('openchamber_stream_debug') === '1';
          } catch {
            return false;
          }
        })();

        if (debugEnabled) console.log('[OpenChamber][VSCode][bootstrap] attempt', { configInitialized });
        if (!configInitialized) {
          await initializeConfig();
        }
        const configState = useConfigStore.getState();
        // If OpenCode is still warming up, the initial provider/agent loads can fail and be swallowed by retries.
        // Only mark bootstrap complete when core datasets are present so we keep retrying on cold starts.
        if (!configState.isInitialized || !configState.isConnected || configState.providers.length === 0 || configState.agents.length === 0) {
          return;
        }
        // Load the session for the VS Code workspace folder
        const workspaceFolder = typeof window !== 'undefined'
          ? (window as unknown as { __VSCODE_CONFIG__?: { workspaceFolder?: string } }).__VSCODE_CONFIG__?.workspaceFolder
          : undefined;
        if (workspaceFolder) {
          await loadSession(workspaceFolder);
        }
        if (debugEnabled) console.log('[OpenChamber][VSCode][bootstrap] post-load', {
          providers: configState.providers.length,
          agents: configState.agents.length,
          sessionId: useChatStore.getState().currentSessionId,
        });
        setHasInitializedOnce(true);
      } catch {
        // Ignore bootstrap failures
      } finally {
        setIsInitializing(false);
      }
    };
    void runBootstrap();
  }, [connectionStatus, configInitialized, hasInitializedOnce, initializeConfig, isInitializing, loadSession]);

  // Track container width for responsive settings layout
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(container);
    // Set initial width
    setContainerWidth(container.clientWidth);

    return () => observer.disconnect();
  }, []);

  const usesMobileLayout = containerWidth > 0 && containerWidth < MOBILE_WIDTH_THRESHOLD;

  return (
    <div ref={containerRef} className="h-full w-full bg-background text-foreground flex flex-col">
      {currentView === 'settings' ? (
        // Settings view
        <SettingsView
          onClose={() => setCurrentView('chat')}
          forceMobile={usesMobileLayout}
        />
      ) : (
        // Chat view
        <div className="flex flex-col h-full">
          <VSCodeHeader
            title={activeSessionTitle}
            showMcp
            showContextUsage
          />
          <div className="flex-1 overflow-hidden">
            <ErrorBoundary>
              <ChatView />
            </ErrorBoundary>
          </div>
        </div>
      )}
    </div>
  );
};

interface VSCodeHeaderProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  onSettings?: () => void;
  onAgentManager?: () => void;
  showMcp?: boolean;
  showContextUsage?: boolean;
}

const VSCodeHeader: React.FC<VSCodeHeaderProps> = ({ title, showBack, onBack, onSettings, onAgentManager, showMcp, showContextUsage }) => {
  const contextUsage = useChatStore((state) => state.contextUsage);

  return (
    <div className="flex items-center gap-1.5 pl-1 pr-2 py-1 border-b border-border bg-background shrink-0">
      {showBack && onBack && (
        <button
          onClick={onBack}
          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Back"
        >
          <RiArrowLeftLine className="h-5 w-5" />
        </button>
      )}
      <h1 className="text-sm font-medium truncate flex-1" title={title}>{title}</h1>
      {onAgentManager && (
        <button
          onClick={onAgentManager}
          className="inline-flex h-9 w-9 items-center justify-center p-2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Open Agent Manager"
        >
          <RiRobot2Line className="h-5 w-5" />
        </button>
      )}
      {showMcp && (
        <McpDropdown
          buttonClassName="inline-flex h-9 w-9 items-center justify-center p-2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      )}
      {onSettings && (
        <button
          onClick={onSettings}
          className="inline-flex h-9 w-9 items-center justify-center p-2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Settings"
        >
          <RiSettings3Line className="h-5 w-5" />
        </button>
      )}
      {showContextUsage && contextUsage && contextUsage.totalTokens > 0 && (
        <ContextUsageDisplay
          totalTokens={contextUsage.totalTokens}
          percentage={contextUsage.percentage}
          contextLimit={contextUsage.contextLimit}
          outputLimit={contextUsage.outputLimit ?? 0}
          size="compact"
        />
      )}
    </div>
  );
};
