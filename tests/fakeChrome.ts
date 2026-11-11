import { vi } from 'vitest';

type StorageListener = (changes: Record<string, unknown>, area: string) => void;

export interface FakeChrome {
  data: Map<string, unknown>;
  emitStorageChanged: () => void;
  openOptionsPage: ReturnType<typeof vi.fn>;
  permissions: {
    contains: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    getAll: ReturnType<typeof vi.fn>;
  };
  scripting: {
    registerContentScripts: ReturnType<typeof vi.fn>;
    unregisterContentScripts: ReturnType<typeof vi.fn>;
    getRegisteredContentScripts: ReturnType<typeof vi.fn>;
    executeScript: ReturnType<typeof vi.fn>;
  };
  tabs: {
    sendMessage: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };
}

/**
 * Подменяет глобальный chrome на управляемую реализацию in-memory storage
 * со стабами permissions/scripting/tabs. Вызывающий тест обязан вызвать
 * vi.unstubAllGlobals() в afterEach.
 */
export function installFakeChrome(initial: Record<string, unknown> = {}): FakeChrome {
  const data = new Map<string, unknown>(Object.entries(initial));
  const listeners = new Set<StorageListener>();

  const chrome = {
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
        remove: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const key of list) data.delete(key);
          for (const listener of listeners) listener({}, 'local');
        },
      },
      onChanged: {
        addListener: (listener: StorageListener) => {
          listeners.add(listener);
        },
        removeListener: (listener: StorageListener) => {
          listeners.delete(listener);
        },
      },
    },
    runtime: {
      openOptionsPage: vi.fn(() => Promise.resolve()),
    },
    permissions: {
      contains: vi.fn(() => Promise.resolve(true)),
      request: vi.fn(() => Promise.resolve(true)),
      remove: vi.fn(() => Promise.resolve(true)),
      getAll: vi.fn(() => Promise.resolve({ permissions: [], origins: [] })),
    },
    scripting: {
      registerContentScripts: vi.fn(() => Promise.resolve()),
      unregisterContentScripts: vi.fn(() => Promise.resolve()),
      getRegisteredContentScripts: vi.fn(() => Promise.resolve([])),
      executeScript: vi.fn(() => Promise.resolve()),
    },
    tabs: {
      sendMessage: vi.fn(() => Promise.resolve()),
      query: vi.fn(() => Promise.resolve([])),
    },
  };

  vi.stubGlobal('chrome', chrome);

  return {
    data,
    emitStorageChanged: () => {
      for (const listener of listeners) listener({}, 'local');
    },
    openOptionsPage: chrome.runtime.openOptionsPage as ReturnType<typeof vi.fn>,
    permissions: chrome.permissions,
    scripting: chrome.scripting,
    tabs: chrome.tabs,
  };
}
