import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// Минимальный заглушечный chrome-объект для тестов, которые не настраивают
// мок storage самостоятельно (например, рендер popup/options).
if (!(globalThis as Record<string, unknown>).chrome) {
  const listeners = new Set<(changes: Record<string, unknown>, area: string) => void>();
  const data = new Map<string, unknown>();
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const result: Record<string, unknown> = {};
          for (const key of list) {
            if (data.has(key)) result[key] = data.get(key);
          }
          return result;
        },
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) data.set(key, value);
          for (const listener of listeners) listener({}, 'local');
        },
      },
      onChanged: {
        addListener: (listener: (changes: Record<string, unknown>, area: string) => void) =>
          listeners.add(listener),
        removeListener: (listener: (changes: Record<string, unknown>, area: string) => void) =>
          listeners.delete(listener),
      },
    },
    runtime: {
      openOptionsPage: () => Promise.resolve(),
    },
  };
}
