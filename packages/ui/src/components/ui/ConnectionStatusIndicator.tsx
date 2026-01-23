import React from 'react';
import { RiWifiLine, RiWifiOffLine, RiLoader4Line, RiRefreshLine, RiSignalWifiErrorLine } from '@remixicon/react';
import { useUIStore } from '@/stores/useUIStore';
import { cn } from '@/lib/utils';
import { Button } from './button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip';

type EventStreamStatus = 'connected' | 'connecting' | 'reconnecting' | 'offline' | 'paused' | 'idle';

const STATUS_CONFIG: Record<EventStreamStatus, {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  color: string;
  animate?: boolean;
  showRetry?: boolean;
}> = {
  connected: {
    icon: RiWifiLine,
    label: 'Connected',
    description: 'Real-time updates active',
    color: 'text-emerald-500',
  },
  connecting: {
    icon: RiLoader4Line,
    label: 'Connecting',
    description: 'Establishing connection...',
    color: 'text-blue-500',
    animate: true,
  },
  reconnecting: {
    icon: RiLoader4Line,
    label: 'Reconnecting',
    description: 'Attempting to restore connection...',
    color: 'text-amber-500',
    animate: true,
    showRetry: true,
  },
  offline: {
    icon: RiWifiOffLine,
    label: 'Offline',
    description: 'No internet connection',
    color: 'text-destructive',
    showRetry: true,
  },
  paused: {
    icon: RiSignalWifiErrorLine,
    label: 'Paused',
    description: 'Connection paused while tab is hidden',
    color: 'text-muted-foreground',
  },
  idle: {
    icon: RiWifiLine,
    label: 'Ready',
    description: 'Waiting for activity',
    color: 'text-muted-foreground',
  },
};

interface ConnectionStatusIndicatorProps {
  /** Show full label text (default: only show on hover via tooltip) */
  showLabel?: boolean;
  /** Show retry button when in error state */
  showRetryButton?: boolean;
  /** Callback when user clicks retry */
  onRetry?: () => void;
  /** Additional class names */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md';
}

/**
 * Displays the current SSE connection status with visual indicator.
 * Shows different icons and colors based on connection state.
 */
export const ConnectionStatusIndicator: React.FC<ConnectionStatusIndicatorProps> = ({
  showLabel = false,
  showRetryButton = true,
  onRetry,
  className,
  size = 'sm',
}) => {
  const status = useUIStore((state) => state.eventStreamStatus) as EventStreamStatus;
  const hint = useUIStore((state) => state.eventStreamHint);

  const config = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
  const IconComponent = config.icon;

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
    } else {
      // Default retry behavior: reload the page
      window.location.reload();
    }
  };

  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';

  const content = (
    <div
      className={cn(
        'flex items-center gap-1.5 transition-colors',
        className
      )}
    >
      <IconComponent
        className={cn(
          iconSize,
          config.color,
          config.animate && 'animate-spin'
        )}
      />
      {showLabel && (
        <span className={cn(textSize, 'text-muted-foreground')}>
          {config.label}
          {hint && ` - ${hint}`}
        </span>
      )}
      {showRetryButton && config.showRetry && (
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 ml-1"
          onClick={handleRetry}
          title="Retry connection"
        >
          <RiRefreshLine className="h-3 w-3" />
        </Button>
      )}
    </div>
  );

  // If showing label, no need for tooltip
  if (showLabel) {
    return content;
  }

  // Otherwise wrap in tooltip
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          {content}
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1">
            <div className="font-medium">{config.label}</div>
            <div className="text-xs text-muted-foreground">
              {config.description}
              {hint && (
                <span className="block mt-0.5 opacity-75">{hint}</span>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/**
 * Full-width banner shown when connection is lost or reconnecting.
 * Displays at the top of the screen with more context and retry options.
 */
export const ConnectionStatusBanner: React.FC<{
  onRetry?: () => void;
  className?: string;
}> = ({ onRetry, className }) => {
  const status = useUIStore((state) => state.eventStreamStatus) as EventStreamStatus;
  const hint = useUIStore((state) => state.eventStreamHint);

  // Only show banner for problematic states
  if (status === 'connected' || status === 'idle' || status === 'paused') {
    return null;
  }

  const config = STATUS_CONFIG[status] || STATUS_CONFIG.reconnecting;
  const IconComponent = config.icon;

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
    } else {
      window.location.reload();
    }
  };

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-4 py-2 border-b',
        status === 'offline' && 'bg-destructive/10 border-destructive/20',
        status === 'reconnecting' && 'bg-amber-500/10 border-amber-500/20',
        status === 'connecting' && 'bg-blue-500/10 border-blue-500/20',
        className
      )}
    >
      <div className="flex items-center gap-2">
        <IconComponent
          className={cn(
            'h-4 w-4',
            config.color,
            config.animate && 'animate-spin'
          )}
        />
        <div>
          <span className="text-sm font-medium">{config.label}</span>
          {hint && (
            <span className="text-sm text-muted-foreground ml-2">
              {hint}
            </span>
          )}
        </div>
      </div>
      {config.showRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleRetry}
          className="gap-1.5"
        >
          <RiRefreshLine className="h-3.5 w-3.5" />
          Retry
        </Button>
      )}
    </div>
  );
};

export default ConnectionStatusIndicator;
