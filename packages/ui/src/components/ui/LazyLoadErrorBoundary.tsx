import React from 'react';
import { RiRefreshLine, RiErrorWarningLine } from '@remixicon/react';
import { Button } from './button';

interface LazyLoadErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  retryCount: number;
}

interface LazyLoadErrorBoundaryProps {
  children: React.ReactNode;
  /** Custom fallback UI when error occurs. If not provided, uses default retry UI */
  fallback?: React.ReactNode;
  /** If true, shows nothing on error (silent fail) */
  silent?: boolean;
  /** Maximum number of automatic retries before showing error UI */
  maxAutoRetries?: number;
  /** Callback when a chunk load error is detected */
  onChunkError?: (error: Error) => void;
}

/**
 * Error boundary specifically designed for React.lazy() components.
 * Handles chunk load failures (stale cache, network issues) with retry logic.
 *
 * Usage:
 * ```tsx
 * <LazyLoadErrorBoundary>
 *   <React.Suspense fallback={<Spinner />}>
 *     <LazyComponent />
 *   </React.Suspense>
 * </LazyLoadErrorBoundary>
 * ```
 */
export class LazyLoadErrorBoundary extends React.Component<
  LazyLoadErrorBoundaryProps,
  LazyLoadErrorBoundaryState
> {
  private retryTimeoutId: NodeJS.Timeout | null = null;

  constructor(props: LazyLoadErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<LazyLoadErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const isChunkLoadError = this.isChunkLoadError(error);

    if (process.env.NODE_ENV === 'development') {
      console.warn('[LazyLoadErrorBoundary] Caught error:', {
        isChunkLoadError,
        error: error.message,
        componentStack: errorInfo.componentStack,
      });
    }

    // Notify parent if it's a chunk load error
    if (isChunkLoadError && this.props.onChunkError) {
      this.props.onChunkError(error);
    }

    // Auto-retry for chunk load errors (likely stale cache)
    const maxAutoRetries = this.props.maxAutoRetries ?? 1;
    if (isChunkLoadError && this.state.retryCount < maxAutoRetries) {
      this.scheduleRetry();
    }
  }

  componentWillUnmount() {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
  }

  /**
   * Detect if the error is from a failed dynamic import (chunk load failure)
   */
  private isChunkLoadError(error: Error): boolean {
    const message = error.message?.toLowerCase() || '';
    const name = error.name?.toLowerCase() || '';

    return (
      message.includes('failed to fetch dynamically imported module') ||
      message.includes('loading chunk') ||
      message.includes('loading css chunk') ||
      message.includes('dynamically imported module') ||
      name.includes('chunkloaderror') ||
      // Vite-specific error patterns
      message.includes('failed to load') ||
      (message.includes('failed') && message.includes('.js'))
    );
  }

  private scheduleRetry = () => {
    // Exponential backoff: 500ms, 1000ms, 2000ms
    const delay = Math.min(500 * Math.pow(2, this.state.retryCount), 2000);

    this.retryTimeoutId = setTimeout(() => {
      this.setState(prev => ({
        hasError: false,
        error: undefined,
        retryCount: prev.retryCount + 1,
      }));
    }, delay);
  };

  private handleManualRetry = () => {
    this.setState({
      hasError: false,
      error: undefined,
      retryCount: this.state.retryCount + 1,
    });
  };

  private handleRefreshPage = () => {
    // Clear service worker cache if available
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
    }
    // Force reload, bypassing cache
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Silent mode - render nothing on error
      if (this.props.silent) {
        return null;
      }

      // Custom fallback provided
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }

      const isChunkError = this.state.error && this.isChunkLoadError(this.state.error);

      // Default retry UI
      return (
        <div className="flex items-center justify-center p-4">
          <div className="flex flex-col items-center gap-3 text-center max-w-xs">
            <RiErrorWarningLine className="h-8 w-8 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {isChunkError ? 'Component failed to load' : 'Something went wrong'}
              </p>
              <p className="text-xs text-muted-foreground">
                {isChunkError
                  ? 'This usually happens after an update. Try refreshing the page.'
                  : 'An error occurred while loading this component.'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={this.handleManualRetry}
                className="gap-1.5"
              >
                <RiRefreshLine className="h-3.5 w-3.5" />
                Retry
              </Button>
              {isChunkError && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={this.handleRefreshPage}
                >
                  Refresh Page
                </Button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Creates a lazy-loaded component with built-in error handling and retry logic.
 * Automatically handles chunk load failures from stale cache.
 *
 * Usage:
 * ```tsx
 * const MyComponent = lazyWithRetry(() => import('./MyComponent'));
 *
 * // Then use with Suspense:
 * <Suspense fallback={<Spinner />}>
 *   <MyComponent />
 * </Suspense>
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  maxRetries = 2
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // On retry, add cache-busting query param
        if (attempt > 0) {
          // Wait with exponential backoff
          await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt - 1)));
        }

        return await importFn();
      } catch (error) {
        lastError = error as Error;

        // Only retry for chunk load errors
        const message = lastError.message?.toLowerCase() || '';
        const isChunkError =
          message.includes('failed to fetch dynamically imported module') ||
          message.includes('loading chunk') ||
          message.includes('failed to load');

        if (!isChunkError) {
          throw error;
        }

        if (process.env.NODE_ENV === 'development') {
          console.warn(`[lazyWithRetry] Attempt ${attempt + 1}/${maxRetries + 1} failed:`, error);
        }
      }
    }

    // All retries exhausted - prompt user to refresh
    console.error('[lazyWithRetry] All retries exhausted, suggesting page refresh');

    // Dispatch a custom event that can be caught globally
    window.dispatchEvent(new CustomEvent('chunk-load-error', {
      detail: { error: lastError }
    }));

    throw lastError;
  });
}

export default LazyLoadErrorBoundary;
