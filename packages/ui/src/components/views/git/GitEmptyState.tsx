import React from 'react';
import { useTranslation } from 'react-i18next';
import { RiGitCommitLine, RiArrowDownLine, RiLoader4Line } from '@remixicon/react';
import { Button } from '@/components/ui/button';

interface GitEmptyStateProps {
  behind: number;
  onPull: () => void;
  isPulling: boolean;
}

export const GitEmptyState: React.FC<GitEmptyStateProps> = ({
  behind,
  onPull,
  isPulling,
}) => {
  const { t } = useTranslation('git');

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <RiGitCommitLine className="size-10 text-emerald-500/60 mb-4" />
      <p className="typography-ui-label font-semibold text-foreground mb-1">
        {t('status.clean')}
      </p>
      <p className="typography-meta text-muted-foreground mb-4">
        {t('status.cleanDescription')}
      </p>

      {behind > 0 && (
        <Button
          variant="outline"
          onClick={onPull}
          disabled={isPulling}
        >
          {isPulling ? (
            <RiLoader4Line className="size-4 animate-spin" />
          ) : (
            <RiArrowDownLine className="size-4" />
          )}
          {t('status.pullCommits', { count: behind })}
        </Button>
      )}
    </div>
  );
};
