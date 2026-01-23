import React from 'react';
import { RiChat3Line, RiRestartLine, RiRefreshLine, RiWifiOffLine } from '@remixicon/react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

interface ChatErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
  errorType: 'chunk' | 'network' | 'timeout' | 'unknown';
  retryCount: number;
}

interface ChatErrorBoundaryProps {
  children: React.ReactNode;
  sessionId?: string;
  onRetry?: () => void;
}

/**
 * Detect the type of error for better user messaging
 */
function detectErrorType(error: Error | undefined): ChatErrorBoundaryState['errorType'] {
  if (!error) return 'unknown';

  const message = error.message?.toLowerCase() || '';
  const name = error.name?.toLowerCase() || '';

  // Chunk load errors (stale cache, failed dynamic imports)
  if (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('loading chunk') ||
    message.includes('loading css chunk') ||
    message.includes('dynamically imported module') ||
    name.includes('chunkloaderror') ||
    (message.includes('failed') && message.includes('.js'))
  ) {
    return 'chunk';
  }

  // Network errors
  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('offline') ||
    name.includes('networkerror') ||
    message.includes('failed to fetch')
  ) {
    return 'network';
  }

  // Timeout errors
  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    name.includes('timeouterror')
  ) {
    return 'timeout';
  }

  return 'unknown';
}

const ERROR_INFO = {
  chunk: {
    icon: RiRefreshLine,
    title: 'Application Update Required',
    description: 'A newer version of the app is available. Please refresh the page to continue.',
    primaryAction: 'Refresh Page',
    showReset: false,
  },
  network: {
    icon: RiWifiOffLine,
    title: 'Connection Lost',
    description: 'Unable to connect to the server. Check your internet connection and try again.',
    primaryAction: 'Retry Connection',
    showReset: true,
  },
  timeout: {
    icon: RiRestartLine,
    title: 'Request Timed Out',
    description: 'The server took too long to respond. This might be due to high load.',
    primaryAction: 'Try Again',
    showReset: true,
  },
  unknown: {
    icon: RiChat3Line,
    title: 'Chat Error',
    description: 'The chat interface encountered an unexpected error.',
    primaryAction: 'Reset Chat',
    showReset: true,
  },
} as const;

export class ChatErrorBoundary extends React.Component<ChatErrorBoundaryProps, ChatErrorBoundaryState> {
  private retryTimeoutId: NodeJS.Timeout | null = null;

  constructor(props: ChatErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorType: 'unknown',
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ChatErrorBoundaryState> {
    return {
      hasError: true,
      error,
      errorType: detectErrorType(error),
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ error, errorInfo });

    // Log for debugging
    if (process.env.NODE_ENV === 'development') {
      console.error('[ChatErrorBoundary] Error caught:', {
        type: this.state.errorType,
        error,
        componentStack: errorInfo.componentStack,
      });
    }

    // Auto-retry for chunk load errors (once)
    if (this.state.errorType === 'chunk' && this.state.retryCount === 0) {
      this.scheduleAutoRetry();
    }
  }

  componentWillUnmount() {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
  }

  private scheduleAutoRetry = () => {
    this.retryTimeoutId = setTimeout(() => {
      this.setState(prev => ({
        hasError: false,
        error: undefined,
        errorInfo: undefined,
        retryCount: prev.retryCount + 1,
      }));
    }, 1000);
  };

  handleReset = () => {
    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
      retryCount: this.state.retryCount + 1,
    });
    this.props.onRetry?.();
  };

  handleRefreshPage = () => {
    // Clear service worker cache if available
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
    }
    // Force reload, bypassing cache
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const errorConfig = ERROR_INFO[this.state.errorType];
      const IconComponent = errorConfig.icon;
      const isChunkError = this.state.errorType === 'chunk';

      return (
        <div className="flex items-center justify-center min-h-[400px] p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <CardTitle className="flex items-center justify-center gap-2 text-destructive">
                <IconComponent className="h-5 w-5" />
                {errorConfig.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                {errorConfig.description}
              </p>

              {this.props.sessionId && (
                <div className="text-xs text-muted-foreground text-center font-mono">
                  Session: {this.props.sessionId}
                </div>
              )}

              {this.state.error && (
                <details className="text-xs font-mono bg-muted p-3 rounded">
                  <summary className="cursor-pointer hover:bg-muted/80 select-none">
                    Error details
                  </summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all">
                    {this.state.error.toString()}
                  </pre>
                </details>
              )}

              <div className="flex gap-2">
                {isChunkError ? (
                  <Button
                    onClick={this.handleRefreshPage}
                    variant="default"
                    className="flex-1"
                  >
                    <RiRefreshLine className="h-4 w-4 mr-2" />
                    {errorConfig.primaryAction}
                  </Button>
                ) : (
                  <Button
                    onClick={this.handleReset}
                    variant="outline"
                    className="flex-1"
                  >
                    <RiRestartLine className="h-4 w-4 mr-2" />
                    {errorConfig.primaryAction}
                  </Button>
                )}

                {errorConfig.showReset && !isChunkError && (
                  <Button
                    onClick={this.handleRefreshPage}
                    variant="ghost"
                    size="icon"
                    title="Refresh page"
                  >
                    <RiRefreshLine className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {this.state.retryCount > 0 && (
                <div className="text-xs text-muted-foreground text-center">
                  Retry attempt: {this.state.retryCount}
                </div>
              )}

              <div className="text-xs text-muted-foreground text-center">
                {isChunkError
                  ? 'The app was updated while you were using it.'
                  : 'If the problem persists, try refreshing the page.'}
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
