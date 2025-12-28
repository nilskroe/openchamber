import React from 'react';
import { useTranslation } from 'react-i18next';

import { OpenChamberLogo } from '@/components/ui/OpenChamberLogo';
import { TextLoop } from '@/components/ui/TextLoop';
import { useOptionalThemeSystem } from '@/contexts/useThemeSystem';

const PHRASE_KEYS = [
    'suggestions.fixTests',
    'suggestions.refactor',
    'suggestions.addValidation',
    'suggestions.optimize',
    'suggestions.writeTests',
    'suggestions.explain',
    'suggestions.addFeature',
    'suggestions.debug',
    'suggestions.review',
    'suggestions.simplify',
    'suggestions.errorHandling',
    'suggestions.createComponent',
    'suggestions.updateDocs',
    'suggestions.findBug',
    'suggestions.improvePerformance',
    'suggestions.addTypes',
] as const;

const ChatEmptyState: React.FC = () => {
    const { t } = useTranslation('chat');
    const themeContext = useOptionalThemeSystem();

    let isDark = true;
    if (themeContext) {
        isDark = themeContext.currentTheme.metadata.variant !== 'light';
    } else if (typeof window !== 'undefined') {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    // Same colors as face fill in OpenChamberLogo, but higher opacity for text readability
    const textColor = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';

    const phrases = PHRASE_KEYS.map((key) => t(key));

    return (
        <div className="flex flex-col items-center justify-center min-h-full w-full gap-6">
            <OpenChamberLogo width={140} height={140} className="opacity-20" isAnimated />
            <TextLoop
                className="text-body-md"
                interval={4}
                transition={{ duration: 0.5 }}
            >
                {phrases.map((phrase, index) => (
                    <span key={PHRASE_KEYS[index]} style={{ color: textColor }}>"{phrase}…"</span>
                ))}
            </TextLoop>
        </div>
    );
};

export default React.memo(ChatEmptyState);
