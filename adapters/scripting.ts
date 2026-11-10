import type { CustomSiteConfig } from '../core/config';
import { contentScriptMatchesForUrl, requestPatternForUrl } from '../core/customSites';
import type { PingMessage } from '../core/messages';

/** Файл content script в сборке — общий для встроенных хостов и custom-сайтов. */
export const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';

export const CUSTOM_SCRIPT_PREFIX = 'dsb-custom-';

export function contentScriptIdForSite(siteId: string): string {
  return `${CUSTOM_SCRIPT_PREFIX}${siteId}`;
}

interface RegisteredContentScript {
  id: string;
  matches?: string[];
  js?: string[];
  runAt?: string;
  persistAcrossSessions?: boolean;
}

interface DesiredContentScript {
  id: string;
  js: string[];
  matches: string[];
  runAt: 'document_idle';
  persistAcrossSessions: true;
}

interface ScriptingApi {
  registerContentScripts(scripts: object[]): Promise<void>;
  unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
  getRegisteredContentScripts(): Promise<RegisteredContentScript[]>;
  executeScript(injection: object): Promise<unknown>;
}

interface TabsApi {
  query(queryInfo: { url?: string }): Promise<{ id?: number }[]>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

function getChromeApis(): { scripting?: ScriptingApi; tabs?: TabsApi } {
  return (globalThis as { chrome?: { scripting?: ScriptingApi; tabs?: TabsApi } }).chrome ?? {};
}

/** Желаемая регистрация для сайта; null, если адрес не выражается в паттернах. */
function desiredRegistration(site: CustomSiteConfig): DesiredContentScript | null {
  const matches = contentScriptMatchesForUrl(site.url);
  if (matches.length === 0) return null;
  return {
    id: contentScriptIdForSite(site.id),
    js: [CONTENT_SCRIPT_FILE],
    matches,
    runAt: 'document_idle',
    persistAcrossSessions: true,
  };
}

function sorted(list: string[] | undefined): string[] {
  return [...(list ?? [])].sort();
}

/**
 * Существенное ли совпадение регистрации с желаемой. Совпадающий id не
 * достаточен: после редактирования адреса сайта matches меняется, и старая
 * регистрация должна быть обновлена, иначе блокировка осталась бы на старом
 * пути. Неуказанные в ответе API поля не сравниваем (дефолты/особенности
 * сборок), чтобы restore после перезапуска не давал ложных перерегистраций.
 */
function registrationMatchesDesired(
  registered: RegisteredContentScript,
  desired: DesiredContentScript,
): boolean {
  if (JSON.stringify(sorted(registered.matches)) !== JSON.stringify(sorted(desired.matches))) {
    return false;
  }
  if (registered.js !== undefined && JSON.stringify(sorted(registered.js)) !== JSON.stringify(sorted(desired.js))) {
    return false;
  }
  if (registered.runAt !== undefined && registered.runAt !== desired.runAt) {
    return false;
  }
  if (registered.persistAcrossSessions !== undefined && registered.persistAcrossSessions !== desired.persistAcrossSessions) {
    return false;
  }
  return true;
}

/**
 * Приводит набор динамически зарегистрированных content scripts в соответствие
 * списку custom-сайтов: лишние (сайт удалён) — снимаются, совпадающие —
 * сохраняются (в том числе восстановленные persistAcrossSessions после
 * перезапуска браузера/SW), расходящиеся (обычно адрес сайта отредактирован) —
 * перерегистрируются. Каждый сайт обрабатывается независимо: ошибка одного
 * правила не ломает остальные.
 */
export async function syncCustomContentScripts(
  sites: readonly CustomSiteConfig[],
): Promise<void> {
  const { scripting } = getChromeApis();
  if (!scripting || typeof scripting.registerContentScripts !== 'function') return;

  const registered = await scripting
    .getRegisteredContentScripts()
    .catch(() => [] as RegisteredContentScript[]);

  const desiredIds = new Set(sites.map((site) => contentScriptIdForSite(site.id)));
  for (const script of registered) {
    if (script.id.startsWith(CUSTOM_SCRIPT_PREFIX) && !desiredIds.has(script.id)) {
      await scripting.unregisterContentScripts({ ids: [script.id] }).catch(() => false);
    }
  }

  for (const site of sites) {
    const desired = desiredRegistration(site);
    if (!desired) continue;
    const existing = registered.find((script) => script.id === desired.id);
    if (existing && registrationMatchesDesired(existing, desired)) continue;
    if (existing) {
      // Расхождение полей регистрации — снимаем старую, ставим новую.
      await scripting.unregisterContentScripts({ ids: [desired.id] }).catch(() => false);
    }

    try {
      await scripting.registerContentScripts([desired]);
    } catch {
      // Дубликат гонки или точный путь не принят — повторяем без точного пути.
      const prefixOnly = desired.matches.filter((pattern) => pattern.endsWith('/*'));
      if (prefixOnly.length === 0) continue;
      try {
        await scripting.registerContentScripts([{ ...desired, matches: prefixOnly }]);
      } catch {
        // Правило недоступно (нет прав/невалидный паттерн) — enforcement отключён,
        // остальные сайты продолжают обрабатываться.
      }
    }
  }
}

/** Убрать регистрации custom content scripts, которых больше нет в конфигурации. */
export async function unregisterAllCustomContentScripts(): Promise<void> {
  const { scripting } = getChromeApis();
  if (!scripting || typeof scripting.getRegisteredContentScripts !== 'function') return;
  const registered = await scripting
    .getRegisteredContentScripts()
    .catch(() => [] as RegisteredContentScript[]);
  const ids = registered
    .map((script) => script.id)
    .filter((id) => id.startsWith(CUSTOM_SCRIPT_PREFIX));
  if (ids.length > 0) {
    await scripting.unregisterContentScripts({ ids }).catch(() => false);
  }
}

/**
 * Обеспечивает content script во вкладках, которые уже открыты на добавленном
 * сайте: регистрация действует на новые загрузки, поэтому живые вкладки
 * досылаем вручную. Страница с работающим скриптом отвечает на ping
 * (дубликатов слушателей не будет — content script сам себя дедуплицирует
 * по метке в DOM).
 */
export async function injectContentScriptIntoTabsMatching(
  sites: readonly CustomSiteConfig[],
): Promise<void> {
  const { scripting, tabs } = getChromeApis();
  if (!scripting || typeof scripting.executeScript !== 'function') return;
  if (!tabs || typeof tabs.query !== 'function') return;

  const ping: PingMessage = { type: 'dsb:ping' };
  for (const site of sites) {
    const pattern = requestPatternForUrl(site.url);
    if (!pattern) continue;
    const matchedTabs = await tabs.query({ url: pattern }).catch(() => []);
    for (const tab of matchedTabs) {
      const tabId = tab.id;
      if (tabId === undefined) continue;
      try {
        await tabs.sendMessage(tabId, ping);
        continue;
      } catch {
        // Скрипт ещё не подключён — инъецируем ниже.
      }
      await scripting
        .executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] })
        .catch(() => false);
    }
  }
}
