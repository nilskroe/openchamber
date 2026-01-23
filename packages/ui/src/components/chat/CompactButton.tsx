import React from 'react';
import { RiDonutChartLine, RiLoader4Line } from '@remixicon/react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MobileOverlayPanel } from '@/components/ui/MobileOverlayPanel';
import { cn } from '@/lib/utils';
import { formatTokensCompact } from '@/lib/modelFormatters';
import { useChatStore } from '@/stores/useChatStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { toast } from 'sonner';

interface CompactButtonProps {
    className?: string;
    isMobile?: boolean;
    iconSizeClass?: string;
    buttonHeightClass?: string;
}

export const CompactButton: React.FC<CompactButtonProps> = ({
    className,
    isMobile = false,
    iconSizeClass = 'h-4 w-4',
    buttonHeightClass = 'h-7 w-7',
}) => {
    const [isCompacting, setIsCompacting] = React.useState(false);
    const [mobileOpen, setMobileOpen] = React.useState(false);

    const currentSessionId = useChatStore((state) => state.currentSessionId);
    const contextUsage = useChatStore((state) => state.contextUsage);

    const currentProviderId = useConfigStore((state) => state.currentProviderId);
    const currentModelId = useConfigStore((state) => state.currentModelId);

    const percentage = contextUsage?.percentage ?? 0;
    const totalTokens = contextUsage?.totalTokens ?? 0;
    const contextLimit = contextUsage?.contextLimit ?? 0;


    const getPercentageColor = (pct: number) => {
        if (pct >= 90) return 'text-[var(--status-error)]';
        if (pct >= 75) return 'text-[var(--status-warning)]';
        return 'text-muted-foreground';
    };

    const handleCompact = React.useCallback(async () => {
        if (!currentSessionId || !currentProviderId || !currentModelId || isCompacting) {
            return;
        }

        setIsCompacting(true);
        setMobileOpen(false);

        try {
            const { opencodeClient } = await import('@/lib/opencode/client');
            const directory = opencodeClient.getDirectory();
            const response = await opencodeClient.getApiClient().session.summarize({
                sessionID: currentSessionId,
                directory: directory || undefined,
                providerID: currentProviderId,
                modelID: currentModelId,
            });

            if (response.error) {
                throw new Error('Failed to compact session');
            }

            toast.success('Session compacted', {
                description: 'Context has been summarized to reduce token usage.',
            });
        } catch (error) {
            console.error('Failed to compact session:', error);
            toast.error('Failed to compact session');
        } finally {
            setIsCompacting(false);
        }
    }, [currentSessionId, currentProviderId, currentModelId, isCompacting]);

    const canCompact = currentSessionId && currentProviderId && currentModelId && !isCompacting && totalTokens > 0;

    const triggerContent = (
        <div
            className={cn(
                'flex items-center gap-1 transition-opacity',
                buttonHeightClass,
                'cursor-pointer hover:opacity-70',
                isCompacting && 'opacity-70',
                className
            )}
        >
            {isCompacting ? (
                <RiLoader4Line className={cn(iconSizeClass, 'animate-spin text-muted-foreground')} />
            ) : (
                <RiDonutChartLine className={cn(iconSizeClass, getPercentageColor(percentage))} />
            )}
            <span className={cn('typography-meta font-medium tabular-nums', getPercentageColor(percentage))}>
                {percentage.toFixed(0)}%
            </span>
        </div>
    );

    const dropdownContent = (
        <>
            <DropdownMenuLabel className="typography-ui-header font-semibold text-foreground">
                Context Usage
            </DropdownMenuLabel>
            <div className="px-2 py-1.5 space-y-1">
                <div className="flex justify-between items-center">
                    <span className="typography-meta text-muted-foreground">Used</span>
                    <span className="typography-meta text-foreground font-medium">{formatTokensCompact(totalTokens)}</span>
                </div>
                <div className="flex justify-between items-center">
                    <span className="typography-meta text-muted-foreground">Limit</span>
                    <span className="typography-meta text-foreground font-medium">{formatTokensCompact(contextLimit)}</span>
                </div>
                <div className="flex justify-between items-center">
                    <span className="typography-meta text-muted-foreground">Usage</span>
                    <span className={cn('typography-meta font-semibold', getPercentageColor(percentage))}>
                        {percentage.toFixed(1)}%
                    </span>
                </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
                disabled={!canCompact}
                onSelect={(e) => {
                    e.preventDefault();
                    void handleCompact();
                }}
                className="typography-meta"
            >
                <div className="flex items-center gap-2">
                    {isCompacting ? (
                        <RiLoader4Line className="h-4 w-4 animate-spin" />
                    ) : (
                        <RiDonutChartLine className="h-4 w-4" />
                    )}
                    <span>{isCompacting ? 'Compacting...' : 'Compact session'}</span>
                </div>
            </DropdownMenuItem>
            <p className="px-2 py-1.5 typography-micro text-muted-foreground/70">
                Summarizes earlier messages to reduce context usage.
            </p>
        </>
    );

    if (!currentSessionId || totalTokens === 0) {
        return null;
    }

    if (isMobile) {
        return (
            <>
                <button
                    type="button"
                    onClick={() => setMobileOpen(true)}
                    className={cn(
                        'flex items-center justify-center',
                        buttonHeightClass,
                        'text-muted-foreground transition-opacity hover:opacity-70'
                    )}
                    aria-label="Context usage"
                >
                    {triggerContent}
                </button>
                <MobileOverlayPanel
                    open={mobileOpen}
                    onClose={() => setMobileOpen(false)}
                    title="Context Usage"
                >
                    <div className="flex flex-col gap-3">
                        <div className="rounded-xl border border-border/40 bg-sidebar/30 px-3 py-2 space-y-1.5">
                            <div className="flex justify-between items-center">
                                <span className="typography-meta text-muted-foreground">Used tokens</span>
                                <span className="typography-meta text-foreground font-medium">{formatTokensCompact(totalTokens)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="typography-meta text-muted-foreground">Context limit</span>
                                <span className="typography-meta text-foreground font-medium">{formatTokensCompact(contextLimit)}</span>
                            </div>
                            <div className="flex justify-between items-center pt-1 border-t border-border/40">
                                <span className="typography-meta text-muted-foreground">Usage</span>
                                <span className={cn('typography-meta font-semibold', getPercentageColor(percentage))}>
                                    {percentage.toFixed(1)}%
                                </span>
                            </div>
                        </div>
                        <button
                            type="button"
                            disabled={!canCompact}
                            onClick={() => void handleCompact()}
                            className={cn(
                                'flex items-center justify-center gap-2 w-full py-2.5 rounded-xl',
                                'bg-primary/10 text-primary font-medium',
                                'disabled:opacity-50 disabled:cursor-not-allowed',
                                'hover:bg-primary/20 transition-colors'
                            )}
                        >
                            {isCompacting ? (
                                <>
                                    <RiLoader4Line className="h-4 w-4 animate-spin" />
                                    <span>Compacting...</span>
                                </>
                            ) : (
                                <>
                                    <RiDonutChartLine className="h-4 w-4" />
                                    <span>Compact session</span>
                                </>
                            )}
                        </button>
                        <p className="typography-meta text-muted-foreground/70 text-center">
                            Summarizes earlier messages to reduce context usage.
                        </p>
                    </div>
                </MobileOverlayPanel>
            </>
        );
    }

    return (
        <Tooltip delayDuration={800}>
            <DropdownMenu>
                <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className={cn(
                                'flex items-center justify-center focus:outline-none',
                                buttonHeightClass
                            )}
                            aria-label="Context usage"
                        >
                            {triggerContent}
                        </button>
                    </DropdownMenuTrigger>
                </TooltipTrigger>
                <DropdownMenuContent align="end" className="w-[200px]">
                    {dropdownContent}
                </DropdownMenuContent>
            </DropdownMenu>
            <TooltipContent side="top">
                <p className="typography-meta">Context: {percentage.toFixed(1)}% used</p>
            </TooltipContent>
        </Tooltip>
    );
};
