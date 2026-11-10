import {
  getDefaultConfig,
  normalizeConfig,
  type ExtensionConfig,
} from '../core/config';
import {
  emptyServiceState,
  rehydrateServiceState,
  type ServiceState,
} from '../core/limits';
import { SERVICE_IDS } from '../core/services';

export const CONFIG_KEY = 'dsb:config';
export const STATE_KEY = 'dsb:state';

/** Состояние трекинга по целям: встроенные сервисы и custom-сайты (ключ — id сайта). */
export type StoredState = Record<string, ServiceState>;

interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/**
 * Записи сериализуются в единую очередь, чтобы перекрывающиеся
 * асинхронные вызовы не переупорядочивали записи и не затирали
 * более новое состояние более старым.
 */
let writeQueue: Promise<boolean> = Promise.resolve(true);

function enqueueSet(items: Record<string, unknown>): Promise<boolean> {
  const storage = getStorageArea();
  if (!storage) return Promise.resolve(false);
  // Снапшот: вызывающий код может мутировать объект до фактической записи.
  const snapshot = structuredClone(items);
  const result = writeQueue
    .catch(() => false)
    .then(() => storage.set(snapshot))
    .then(() => true)
    .catch(() => false);
  writeQueue = result;
  return result;
}

function getStorageArea(): StorageArea | null {
  const chromeApi = (globalThis as { chrome?: { storage?: { local?: StorageArea } } }).chrome;
  const local = chromeApi?.storage?.local;
  if (!local || typeof local.get !== 'function' || typeof local.set !== 'function') {
    return null;
  }
  return local;
}

export async function loadConfig(): Promise<ExtensionConfig> {
  const storage = getStorageArea();
  if (!storage) return getDefaultConfig();
  try {
    const raw = await storage.get(CONFIG_KEY);
    return normalizeConfig(raw[CONFIG_KEY]);
  } catch {
    return getDefaultConfig();
  }
}

export async function saveConfig(config: ExtensionConfig): Promise<boolean> {
  return enqueueSet({ [CONFIG_KEY]: config });
}

/** Сырые состояния из хранилища (без пересчёта). */
async function loadRawState(): Promise<Record<string, Partial<ServiceState>>> {
  const storage = getStorageArea();
  if (!storage) return {};
  try {
    const raw = await storage.get(STATE_KEY);
    const state = raw[STATE_KEY];
    return typeof state === 'object' && state !== null
      ? (state as Record<string, Partial<ServiceState>>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Загружает состояние трекинга и приводит его в актуальное: пересчитывает
 * смену дня и 10-минутный сброс сессии, чтобы корректно пережить перезапуск
 * service worker и браузера.
 *
 * `knownTargets` — актуальный список отслеживаемых целей (встроенные +
 * id custom-сайтов из конфигурации): ключи вне списка отбрасываются —
 * так состояние удалённого custom-сайта исчезает из хранилища. Без списка
 * (UI-вызовы) сохраняются все ключи.
 */
export async function loadState(
  now: Date | number = new Date(),
  knownTargets?: readonly string[],
): Promise<StoredState> {
  const raw = await loadRawState();
  const ids = knownTargets ?? [...SERVICE_IDS, ...Object.keys(raw)];
  const result: StoredState = {};
  for (const id of ids) {
    result[id] = rehydrateServiceState(raw[id], now);
  }
  return result;
}

export function emptyState(
  now: Date | number = new Date(),
  targets: readonly string[] = SERVICE_IDS,
): StoredState {
  const result: StoredState = {};
  for (const id of targets) {
    result[id] = emptyServiceState(now);
  }
  return result;
}

export async function saveState(state: StoredState): Promise<boolean> {
  return enqueueSet({ [STATE_KEY]: state });
}
