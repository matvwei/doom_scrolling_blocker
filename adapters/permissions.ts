import type { CustomSiteConfig, ExtensionConfig } from '../core/config';
import { requestPatternForUrl } from '../core/customSites';

interface PermissionsApi {
  contains(permissions: { origins?: string[] }): Promise<boolean>;
  request(permissions: { origins?: string[] }): Promise<boolean>;
  remove(permissions: { origins?: string[] }): Promise<boolean>;
  getAll(): Promise<{ permissions?: string[]; origins?: string[] }>;
}

function getPermissionsApi(): PermissionsApi | null {
  const permissions = (globalThis as { chrome?: { permissions?: PermissionsApi } }).chrome
    ?.permissions;
  if (
    !permissions ||
    typeof permissions.contains !== 'function' ||
    typeof permissions.request !== 'function'
  ) {
    return null;
  }
  return permissions;
}

/** Origin-паттерн, который запрашивается у пользователя для правила сайта. */
export function sitePermissionPattern(site: Pick<CustomSiteConfig, 'url'>): string | null {
  return requestPatternForUrl(site.url);
}

/**
 * Гарантирует host permission для всех переданных сайтов: уже выданные
 * паттерны пропускаются, недостающие запрашиваются одним вызовом
 * chrome.permissions.request из пользовательского действия (клик «Сохранить»).
 *
 * Возвращает false, если API недоступен или пользователь отклонил запрос —
 * вызывающий код обязан НЕ сохранять такие правила, чтобы сайт не считался
 * активным молча.
 */
export async function requestPermissionsForSites(
  sites: readonly CustomSiteConfig[],
): Promise<boolean> {
  if (sites.length === 0) return true;
  const api = getPermissionsApi();
  if (!api) return false;

  const missing: string[] = [];
  for (const site of sites) {
    const pattern = sitePermissionPattern(site);
    if (!pattern) return false;
    const granted = await api.contains({ origins: [pattern] }).catch(() => false);
    if (!granted) missing.push(pattern);
  }
  if (missing.length === 0) return true;
  return api.request({ origins: missing }).catch(() => false);
}

// Постоянные host_permissions манифеста: их нельзя отозвать через
// permissions.remove (Chrome вернёт ошибку), поэтому не пытаемся.
const BUILTIN_HOSTS = ['www.youtube.com', 'm.youtube.com', 'www.instagram.com', 'instagram.com', 'www.tiktok.com', 'tiktok.com'];

function isBuiltinHostPermission(origin: string): boolean {
  try {
    return BUILTIN_HOSTS.includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * Отзывает выданные ранее optional origins, которые больше не используются
 * ни одним custom-сайтом (например, после удаления или смены адреса сайта).
 * Лишний remove безопасно игнорируется.
 */
export async function removeUnusedSitePermissions(config: ExtensionConfig): Promise<void> {
  const api = getPermissionsApi();
  if (!api || typeof api.getAll !== 'function' || typeof api.remove !== 'function') return;

  const granted = await api.getAll().catch(() => null);
  if (!granted) return;

  const referenced = new Set(
    config.customSites
      .map((site) => sitePermissionPattern(site))
      .filter((pattern): pattern is string => pattern !== null),
  );

  for (const origin of granted.origins ?? []) {
    if (!/^https?:\/\//.test(origin)) continue;
    if (isBuiltinHostPermission(origin)) continue;
    if (referenced.has(origin)) continue;
    await api.remove({ origins: [origin] }).catch(() => false);
  }
}
