import { validateConfig, type ExtensionConfig } from '../core/config';
import { SERVICE_IDS } from '../core/services';
import { permissionsSatisfied } from './permissions';
import { clearPendingConfig, loadPendingConfig, saveConfig } from './storage';

/**
 * Черновик прерванного сохранения достраивается только в well-formed виде.
 * Нормализация дефолтами тут недопустима: «починенный» черновик молча затирал
 * бы реальный config значениями по умолчанию. Повреждённый черновик
 * вызывающий код обязан очистить (clearPendingConfig).
 *
 * Проверка не бросает исключений на любых данных (validateConfig опирается
 * на корректную форму и может упасть на произвольном объекте).
 */
export function isResumablePendingConfig(pending: unknown): pending is ExtensionConfig {
  try {
    if (typeof pending !== 'object' || pending === null) return false;
    const candidate = pending as ExtensionConfig;
    if (candidate.version !== 2) return false;
    if (candidate.youtubeScope !== 'shorts' && candidate.youtubeScope !== 'all') return false;
    if (typeof candidate.services !== 'object' || candidate.services === null) return false;
    for (const id of SERVICE_IDS) {
      const service = candidate.services[id];
      if (typeof service !== 'object' || service === null) return false;
    }
    if (!Array.isArray(candidate.customSites)) return false;
    return validateConfig(candidate) === null;
  } catch {
    return false;
  }
}

/**
 * Достраивает сохранение, прерванное нативным prompt разрешений (фоновый
 * обработчик permissions.onAdded). Возвращает true, если черновик сохранён.
 *
 * Семантика свежести: saveConfig инвалидирует черновик, поэтому любое
 * постороннее изменение config делает повторное чтение пустым — свежий
 * config не затирается. Черновик перечитывается непосредственно перед
 * записью, чтобы сузить гонку между проверкой разрешений и сохранением.
 * Повреждённый черновик очищается; неподтверждённый доступ оставляет
 * черновик в хранилище (настройки восстановят его при открытии).
 */
export async function tryResumePendingConfig(): Promise<boolean> {
  const pending = await loadPendingConfig();
  if (!pending) return false;
  if (!isResumablePendingConfig(pending)) {
    await clearPendingConfig();
    return false;
  }
  if (!(await permissionsSatisfied(pending.customSites))) return false;
  // Повторное чтение перед записью: пока шли contains-проверки, config мог
  // сохраниться из другого места и инвалидировать черновик.
  const fresh = await loadPendingConfig();
  if (!fresh) return false;
  if (!isResumablePendingConfig(fresh)) {
    await clearPendingConfig();
    return false;
  }
  return saveConfig(fresh);
}
