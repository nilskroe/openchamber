import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  RiRefreshLine,
  RiArrowDownLine,
  RiArrowUpLine,
  RiLoader4Line,
} from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type SyncAction = 'fetch' | 'pull' | 'push' | null;

interface SyncActionsProps {
  syncAction: SyncAction;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  disabled: boolean;
}

export const SyncActions: React.FC<SyncActionsProps> = ({
  syncAction,
  onFetch,
  onPull,
  onPush,
  disabled,
}) => {
  const { t } = useTranslation('git');
  const isDisabled = disabled || syncAction !== null;

  return (
    <div className="flex items-center gap-0.5">
      <Tooltip delayDuration={1000}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={onFetch}
            disabled={isDisabled}
          >
            {syncAction === 'fetch' ? (
              <RiLoader4Line className="size-4 animate-spin" />
            ) : (
              <RiRefreshLine className="size-4" />
            )}
            <span className="hidden sm:inline">{t('remote.fetch')}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>{t('remote.fetchFromRemote')}</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={1000}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={onPull}
            disabled={isDisabled}
          >
            {syncAction === 'pull' ? (
              <RiLoader4Line className="size-4 animate-spin" />
            ) : (
              <RiArrowDownLine className="size-4" />
            )}
            <span className="hidden sm:inline">{t('remote.pull')}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>{t('remote.pullChanges')}</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={1000}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={onPush}
            disabled={isDisabled}
          >
            {syncAction === 'push' ? (
              <RiLoader4Line className="size-4 animate-spin" />
            ) : (
              <RiArrowUpLine className="size-4" />
            )}
            <span className="hidden sm:inline">{t('remote.push')}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>{t('remote.pushChanges')}</TooltipContent>
      </Tooltip>
    </div>
  );
};
