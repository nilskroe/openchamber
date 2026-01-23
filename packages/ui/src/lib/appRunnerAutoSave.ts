import { useAppRunnerStore } from '@/stores/useAppRunnerStore';
import { updateDesktopSettings } from '@/lib/persistence';
import type { DesktopSettings } from '@/lib/desktop';

type AppRunnerSlice = {
  enabled: boolean;
  command: string;
};

let initialized = false;

export const startAppRunnerAutoSave = (): void => {
  if (initialized || typeof window === 'undefined') {
    return;
  }

  initialized = true;

  let previous: AppRunnerSlice = {
    enabled: useAppRunnerStore.getState().enabled,
    command: useAppRunnerStore.getState().command,
  };

  let pending: Partial<DesktopSettings> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    const payload = pending;
    pending = null;
    timer = null;
    if (payload && Object.keys(payload).length > 0) {
      void updateDesktopSettings(payload);
    }
  };

  const schedule = (changes: Partial<DesktopSettings>) => {
    pending = { ...(pending ?? {}), ...changes };
    if (timer) {
      return;
    }
    timer = setTimeout(flush, 150);
  };

  useAppRunnerStore.subscribe((state) => {
    const current: AppRunnerSlice = {
      enabled: state.enabled,
      command: state.command,
    };

    const diff: Partial<DesktopSettings> = {};

    if (current.enabled !== previous.enabled) {
      diff.appRunnerEnabled = current.enabled;
    }
    if (current.command !== previous.command) {
      diff.appRunnerCommand = current.command;
    }

    previous = current;

    if (Object.keys(diff).length > 0) {
      schedule(diff);
    }
  });
};
