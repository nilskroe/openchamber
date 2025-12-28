import React from 'react';
import { useTranslation } from 'react-i18next';
import { RiArrowDownLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface AIHighlightsBoxProps {
  highlights: string[];
  onInsert: () => void;
  onClear: () => void;
}

export const AIHighlightsBox: React.FC<AIHighlightsBoxProps> = ({
  highlights,
  onInsert,
  onClear,
}) => {
  const { t } = useTranslation('git');

  if (highlights.length === 0) {
    return null;
  }

  const handleInsert = () => {
    onInsert();
    onClear();
  };

  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-background/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="typography-micro text-muted-foreground">{t('ai.highlights')}</p>
        <Tooltip delayDuration={1000}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={handleInsert}
              aria-label={t('ai.insertHighlights')}
            >
              <RiArrowDownLine className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent sideOffset={8}>
            {t('ai.appendHighlights')}
          </TooltipContent>
        </Tooltip>
      </div>
      <ul className="space-y-1">
        {highlights.map((highlight, index) => (
          <li key={index} className="typography-meta text-foreground">
            {highlight}
          </li>
        ))}
      </ul>
    </div>
  );
};
