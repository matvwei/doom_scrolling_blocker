import { useCallback, useEffect, useState } from 'react';
import type { ExtensionConfig } from '../core/config';
import { CONFIG_KEY, STATE_KEY, loadConfig, loadState, saveConfig, type StoredState } from '../adapters/storage';

export interface ExtensionData {
  config: ExtensionConfig | null;
  state: StoredState | null;
  saveConfig: (config: ExtensionConfig) => Promise<boolean>;
}

/** Конфигурация и статистика из chrome.storage с автоматическим обновлением. */
export function useExtensionData(): ExtensionData {
  const [config, setConfig] = useState<ExtensionConfig | null>(null);
  const [state, setState] = useState<StoredState | null>(null);

  useEffect(() => {
    let cancelled = false;

    const reload = async () => {
      const [nextConfig, nextState] = await Promise.all([loadConfig(), loadState()]);
      if (cancelled) return;
      setConfig(nextConfig);
      setState(nextState);
    };

    void reload();

    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local') return;
      if (changes[CONFIG_KEY] || changes[STATE_KEY]) void reload();
    };
    chrome.storage.onChanged.addListener(onChanged);

    // Интервал подстраховывает там, где событие storage.onChanged недоступно,
    // и обновляет оставшееся время в popup раз в секунду.
    const interval = setInterval(() => {
      void loadState().then((nextState) => {
        if (!cancelled) setState(nextState);
      });
    }, 1000);

    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
      clearInterval(interval);
    };
  }, []);

  const save = useCallback(async (next: ExtensionConfig) => {
    const ok = await saveConfig(next);
    if (ok) setConfig(next);
    return ok;
  }, []);

  return { config, state, saveConfig: save };
}
