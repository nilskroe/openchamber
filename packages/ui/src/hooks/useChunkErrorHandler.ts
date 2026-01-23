import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

/**
 * Detects if an error is a chunk/module load failure.
 * These typically occur when the app has been updated and the browser
 * has cached references to old chunk hashes.
 */
function isChunkLoadError(error: Error | ErrorEvent | unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error))?.toLowerCase() || '';

  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('loading chunk') ||
    message.includes('loading css chunk') ||
    message.includes('dynamically imported module') ||
    message.includes('chunkloaderror') ||
    // Vite/webpack specific patterns
    (message.includes('failed') && message.includes('.js')) ||
    (message.includes('failed to load') && message.includes('module'))
  );
}

/**
 * Hook that listens for global chunk load errors (stale cache issues)
 * and shows a toast notification prompting the user to refresh.
 *
 * These errors occur when:
 * 1. The app was updated while the user had it open
 * 2. The browser cached the old main bundle with references to old chunk hashes
 * 3. A dynamic import tries to load a chunk that no longer exists
 */
export function useChunkErrorHandler() {
  const hasShownToast = useRef(false);
  const lastErrorTime = useRef(0);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      // Debounce - don't show multiple toasts for the same error cascade
      const now = Date.now();
      if (now - lastErrorTime.current < 5000) {
        return;
      }

      if (isChunkLoadError(event.error || event.message)) {
        event.preventDefault(); // Prevent default error handling

        lastErrorTime.current = now;

        // Only show the toast once per session
        if (!hasShownToast.current) {
          hasShownToast.current = true;

          toast.error('App Update Available', {
            description: 'A newer version is available. Please refresh to continue.',
            duration: Infinity,
            action: {
              label: 'Refresh',
              onClick: () => {
                // Clear service worker cache if available
                if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                  navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
                }
                window.location.reload();
              },
            },
            onDismiss: () => {
              // Allow showing again after 30 seconds if dismissed
              setTimeout(() => {
                hasShownToast.current = false;
              }, 30000);
            },
          });
        }
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      // Debounce
      const now = Date.now();
      if (now - lastErrorTime.current < 5000) {
        return;
      }

      if (isChunkLoadError(event.reason)) {
        event.preventDefault();

        lastErrorTime.current = now;

        if (!hasShownToast.current) {
          hasShownToast.current = true;

          toast.error('Component Failed to Load', {
            description: 'This usually happens after an update. Refresh to fix.',
            duration: 10000,
            action: {
              label: 'Refresh',
              onClick: () => {
                if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                  navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
                }
                window.location.reload();
              },
            },
            onDismiss: () => {
              setTimeout(() => {
                hasShownToast.current = false;
              }, 30000);
            },
          });
        }
      }
    };

    // Custom event from lazyWithRetry when all retries exhausted
    const handleCustomChunkError = (event: CustomEvent) => {
      const now = Date.now();
      if (now - lastErrorTime.current < 5000) {
        return;
      }

      lastErrorTime.current = now;

      if (!hasShownToast.current) {
        hasShownToast.current = true;

        toast.error('App Update Required', {
          description: 'Please refresh the page to load the latest version.',
          duration: Infinity,
          action: {
            label: 'Refresh Now',
            onClick: () => {
              if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
              }
              window.location.reload();
            },
          },
        });
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('chunk-load-error', handleCustomChunkError as EventListener);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('chunk-load-error', handleCustomChunkError as EventListener);
    };
  }, []);
}
