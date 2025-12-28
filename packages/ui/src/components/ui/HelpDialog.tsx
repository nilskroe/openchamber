import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUIStore } from '@/stores/useUIStore';
import { RiAddLine, RiArrowUpSLine, RiArrowUpWideLine, RiCloseCircleLine, RiCodeLine, RiCommandLine, RiGitBranchLine, RiLayoutLeftLine, RiPaletteLine, RiQuestionLine, RiSettings3Line, RiTerminalBoxLine, RiText } from '@remixicon/react';

const renderKeyToken = (token: string, index: number) => {
  const normalized = token.trim().toLowerCase();

  if (normalized === 'ctrl' || normalized === 'control') {
    return <RiArrowUpSLine key={`ctrl-${index}`} className="h-3.5 w-3.5" />;
  }

  if (normalized === 'shift' || normalized === '⇧') {
    return <RiArrowUpWideLine key={`shift-${index}`} className="h-3.5 w-3.5" />;
  }

  if (normalized === '⌘' || normalized === 'cmd' || normalized === 'command' || normalized === 'meta') {
    return <RiCommandLine key={`cmd-${index}`} className="h-3.5 w-3.5" />;
  }

  return <span key={`key-${index}`} className="text-xs font-medium">{token.trim()}</span>;
};

const renderKeyCombo = (combo: string) => {
  const tokens = combo.split('+').map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return combo.trim();
  }

  return tokens.map((token, index) => (
    <React.Fragment key={`${token}-${index}`}>
      {index > 0 && <span className="text-muted-foreground text-[10px]">+</span>}
      {renderKeyToken(token, index)}
    </React.Fragment>
  ));
};

type ShortcutIcon = React.ComponentType<{ className?: string }>;

type ShortcutItem = {
  keys: string | string[];
  description: string;
  icon: ShortcutIcon | null;
};

type ShortcutSection = {
  category: string;
  items: ShortcutItem[];
};

export const HelpDialog: React.FC = () => {
  const { t } = useTranslation('ui');
  const { isHelpDialogOpen, setHelpDialogOpen } = useUIStore();

  const shortcuts: ShortcutSection[] = [
    {
      category: t('help.categories.navigation', 'Navigation & Commands'),
      items: [
        { keys: ["Ctrl + X"], description: t('help.shortcuts.openCommandPalette', 'Open Command Palette'), icon: RiCommandLine },
        { keys: ["Ctrl + H"], description: t('help.shortcuts.showKeyboardShortcuts', 'Show Keyboard Shortcuts (this dialog)'), icon: RiQuestionLine },
        { keys: ["Ctrl + L"], description: t('help.shortcuts.toggleSessionSidebar', 'Toggle Session Sidebar'), icon: RiLayoutLeftLine },
      ]
    },
    {
      category: t('help.categories.sessionManagement', 'Session Management'),
      items: [
        { keys: ["Ctrl + N"], description: t('help.shortcuts.createNewSession', 'Create New Session'), icon: RiAddLine },
        { keys: ["Shift + Ctrl + N"], description: t('help.shortcuts.openWorktreeCreator', 'Open Worktree Creator'), icon: RiGitBranchLine },
        { keys: ["Ctrl + I"], description: t('help.shortcuts.focusChatInput', 'Focus Chat Input'), icon: RiText },
        { keys: ["Esc + Esc"], description: t('help.shortcuts.abortActiveRun', 'Abort active run (double press)'), icon: RiCloseCircleLine },
      ]
    },
    {
      category: t('help.categories.interface', 'Interface'),
      items: [
        { keys: ["⌘ + /", "Ctrl + /"], description: t('help.shortcuts.cycleTheme', 'Cycle Theme (Light → Dark → System)'), icon: RiPaletteLine },
        { keys: ["Ctrl + E"], description: t('help.shortcuts.openDiffPanel', 'Open Diff Panel'), icon: RiCodeLine },
        { keys: ["Ctrl + G"], description: t('help.shortcuts.openGitPanel', 'Open Git Panel'), icon: RiGitBranchLine },
        { keys: ["Ctrl + T"], description: t('help.shortcuts.openTerminal', 'Open Terminal'), icon: RiTerminalBoxLine },
        { keys: ["Ctrl + ,"], description: t('help.shortcuts.openSettings', 'Open Settings'), icon: RiSettings3Line },
      ]
    }
  ];

  return (
    <Dialog open={isHelpDialogOpen} onOpenChange={setHelpDialogOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RiSettings3Line className="h-5 w-5" />
            {t('help.title', 'Keyboard Shortcuts')}
          </DialogTitle>
          <DialogDescription>
            {t('help.description', 'Use these keyboard shortcuts to navigate and control the application quickly.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-3">
          {shortcuts.map((section) => (
            <div key={section.category}>
              <h3 className="typography-meta font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {section.category}
              </h3>
              <div className="space-y-1">
                {section.items.map((shortcut, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-1 px-2"
                  >
                    <div className="flex items-center gap-2">
                      {shortcut.icon && (
                        <shortcut.icon className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span className="typography-meta">{shortcut.description}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {(Array.isArray(shortcut.keys) ? shortcut.keys : shortcut.keys.split(' / ')).map((keyCombo: string, i: number) => (
                        <React.Fragment key={`${keyCombo}-${i}`}>
                          {i > 0 && <span className="typography-meta text-muted-foreground mx-1">or</span>}
                          <kbd className="inline-flex items-center gap-1 px-1.5 py-0.5 typography-meta font-mono bg-muted rounded border border-border/20">
                            {renderKeyCombo(keyCombo)}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 p-2 bg-muted/30 rounded-xl">
          <div className="flex items-start gap-2">
            <RiQuestionLine className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
            <div className="typography-meta text-muted-foreground">
              <p className="font-medium mb-1">{t('help.proTips.title', 'Pro Tips:')}</p>
               <ul className="space-y-0.5 typography-meta">
                 <li>• {t('help.proTips.commandPalette', 'Use Command Palette (Ctrl + X) to quickly access all actions')}</li>
                 <li>• {t('help.proTips.recentSessions', 'The 5 most recent sessions appear in the Command Palette')}</li>
                 <li>• {t('help.proTips.themeCycling', 'Theme cycling remembers your preference across sessions')}</li>
               </ul>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
