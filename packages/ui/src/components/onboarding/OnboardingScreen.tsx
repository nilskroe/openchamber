import React from 'react';
import { useTranslation } from 'react-i18next';
import { RiFileCopyLine, RiCheckLine, RiExternalLinkLine } from '@remixicon/react';

const INSTALL_COMMAND = 'curl -fsSL https://opencode.ai/install | bash';
const POLL_INTERVAL_MS = 3000;

type OnboardingScreenProps = {
  onCliAvailable?: () => void;
};

function BashCommand({ onCopy, copyTitle }: { onCopy: () => void; copyTitle: string }) {
  return (
    <div className="flex items-center justify-center gap-3">
      <code>
        <span style={{ color: 'var(--syntax-keyword)' }}>curl</span>
        <span className="text-muted-foreground"> -fsSL </span>
        <span style={{ color: 'var(--syntax-string)' }}>https://opencode.ai/install</span>
        <span className="text-muted-foreground"> | </span>
        <span style={{ color: 'var(--syntax-keyword)' }}>bash</span>
      </code>
      <button
        onClick={onCopy}
        className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
        title={copyTitle}
      >
        <RiFileCopyLine className="h-4 w-4" />
      </button>
    </div>
  );
}

const HINT_DELAY_MS = 30000;

export function OnboardingScreen({ onCliAvailable }: OnboardingScreenProps) {
  const { t } = useTranslation('ui');
  const [copied, setCopied] = React.useState(false);
  const [showHint, setShowHint] = React.useState(false);
  const [isDesktopApp, setIsDesktopApp] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => setShowHint(true), HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  React.useEffect(() => {
    setIsDesktopApp(typeof (window as typeof window & { opencodeDesktop?: unknown }).opencodeDesktop !== 'undefined');
  }, []);

  const handleDragStart = React.useCallback(async (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, code')) {
      return;
    }
    if (e.button !== 0) return;
    if (isDesktopApp) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const window = getCurrentWindow();
        await window.startDragging();
      } catch (error) {
        console.error('Failed to start window dragging:', error);
      }
    }
  }, [isDesktopApp]);

  const checkCliAvailability = React.useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch('/health');
      if (!response.ok) return false;
      const data = await response.json();
      return data.cliAvailable === true;
    } catch {
      return false;
    }
  }, []);

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  React.useEffect(() => {
    const poll = async () => {
      const available = await checkCliAvailability();
      if (available) {
        onCliAvailable?.();
      }
    };

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    poll();

    return () => clearInterval(interval);
  }, [checkCliAvailability, onCliAvailable]);

  return (
    <div
      className="h-full flex items-center justify-center bg-transparent p-8 relative cursor-default select-none"
      onMouseDown={handleDragStart}
    >
      <div className="w-full space-y-4 text-center">
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {t('onboarding.welcome', 'Welcome to OpenChamber')}
          </h1>
          <p className="text-muted-foreground">
            <a
              href="https://opencode.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              OpenCode CLI
              <RiExternalLinkLine className="h-4 w-4" />
            </a>
            {' '}{t('onboarding.cliRequired', 'is required to continue.')}
          </p>
        </div>

        <div className="flex justify-center">
          <div className="bg-background/60 backdrop-blur-sm border border-border rounded-lg px-5 py-3 font-mono text-sm w-fit">
            {copied ? (
              <div className="flex items-center justify-center gap-2" style={{ color: 'var(--status-success)' }}>
                <RiCheckLine className="h-4 w-4" />
                {t('onboarding.copied', 'Copied to clipboard')}
              </div>
            ) : (
              <BashCommand onCopy={handleCopy} copyTitle={t('onboarding.copyToClipboard', 'Copy to clipboard')} />
            )}
          </div>
        </div>

        <a
          href="https://opencode.ai/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 justify-center"
        >
          {t('onboarding.viewDocs', 'View documentation')}
          <RiExternalLinkLine className="h-3 w-3" />
        </a>

        <p className="text-sm text-muted-foreground animate-pulse">
          {t('onboarding.waiting', 'Waiting for OpenCode installation...')}
        </p>
      </div>

      {showHint && (
        <div className="absolute bottom-8 left-0 right-0 text-center space-y-1">
          <p className="text-sm text-muted-foreground/70">
            {t('onboarding.hintPath', 'Already installed? Make sure')} <code className="text-foreground/70">opencode</code> {t('onboarding.hintPathEnd', 'is in your PATH')}
          </p>
          <p className="text-sm text-muted-foreground/70">
            {t('onboarding.hintEnv', 'or set')} <code className="text-foreground/70">OPENCODE_BINARY</code> {t('onboarding.hintEnvEnd', 'environment variable.')}
          </p>
        </div>
      )}
    </div>
  );
}
