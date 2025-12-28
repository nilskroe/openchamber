import React from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '@/stores/useUIStore';
import { SUPPORTED_LANGUAGES } from '@/lib/i18n/config';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const LanguageSettings: React.FC = () => {
  const { t } = useTranslation('settings');
  const { language, setLanguage } = useUIStore();

  // Find current language object for display
  const currentLang = SUPPORTED_LANGUAGES.find(l => l.code === language);
  const displayValue = currentLang
    ? `${currentLang.nativeName}`
    : language;

  return (
    <SettingsSection
      title={t('language.title', 'Language')}
      description={t('language.description', 'Choose your preferred display language')}
    >
      <div className="flex items-center gap-4">
        <span className="typography-ui-label text-muted-foreground min-w-[100px]">
          {t('language.selectLabel', 'Display language')}
        </span>
        <Select value={language} onValueChange={setLanguage}>
          <SelectTrigger className="w-full max-w-[200px]">
            <SelectValue>{displayValue}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_LANGUAGES.map((lang) => (
              <SelectItem key={lang.code} value={lang.code}>
                <span className="flex items-center gap-2">
                  <span>{lang.nativeName}</span>
                  {lang.nativeName !== lang.label && (
                    <span className="text-muted-foreground">({lang.label})</span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </SettingsSection>
  );
};
