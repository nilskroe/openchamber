import React from 'react';
import { RiMacbookLine, RiExternalLinkLine, RiDownloadLine } from '@remixicon/react';
import { isWebRuntime } from '@/lib/desktop';

const DESKTOP_APP_SCHEME = 'openchamber://';
const DOWNLOAD_URL = 'https://github.com/btriapitsyn/openchamber/releases/latest';

export const DesktopAppSettings: React.FC = () => {
  const [launchAttempted, setLaunchAttempted] = React.useState(false);
  const isWeb = React.useMemo(() => isWebRuntime(), []);

  // Only show in web runtime
  if (!isWeb) {
    return null;
  }

  const handleLaunchApp = () => {
    setLaunchAttempted(true);
    // Try to open the app via custom URL scheme
    window.location.href = DESKTOP_APP_SCHEME;
  };

  const handleDownload = () => {
    window.open(DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="typography-ui-header font-semibold text-foreground">Desktop App</h3>
        <p className="typography-meta text-muted-foreground">
          Launch OpenChamber in the native Mac app for better performance and system integration.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={handleLaunchApp}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <RiMacbookLine className="h-4 w-4" />
          Open Desktop App
        </button>

        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <RiDownloadLine className="h-4 w-4" />
          Download
          <RiExternalLinkLine className="h-3 w-3 opacity-50" />
        </button>
      </div>

      {launchAttempted && (
        <p className="typography-micro text-muted-foreground">
          If the app didn't open, make sure OpenChamber is installed on your Mac.
        </p>
      )}
    </div>
  );
};
