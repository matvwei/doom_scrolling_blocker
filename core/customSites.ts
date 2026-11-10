/**
 * Пользовательские сайты: парсинг адреса правила, сопоставление с URL,
 * генерация match-паттернов для запроса разрешений и регистрации content script.
 *
 * Синтаксис адреса правила: http(s)://домен[/раздел]
 * - `https://example.com`     — домен и все поддомены, любые пути;
 * - `https://example.com/foo` — домен и поддомены, раздел /foo и всё ниже (path prefix).
 * Схема учитывается строго: правило для https не ловит http и наоборот.
 */

export interface CustomSiteRule {
  scheme: 'http' | 'https';
  /** Хост нижнего регистра без порта. */
  domain: string;
  /** null — любой путь; иначе префикс пути (без trailing slash). */
  pathPrefix: string | null;
}

/**
 * Разбирает адрес правила. Возвращает null для некорректных/опасных URL:
 * не http/https, с авторизацией в адресе, с нестандартным портом
 * (match-паттерны Chrome не выражают произвольные порты).
 */
export function parseCustomSiteUrl(raw: string): CustomSiteRule | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  // Явные порты отличные от дефолтных схемы невыразимы в match-паттернах;
  // дефолтные (80/443) URL-парсер нормализует в пустую строку.
  if (url.port) return null;
  const domain = url.hostname.toLowerCase();
  if (!domain) return null;

  const path = url.pathname.replace(/\/+$/, '') || '/';
  return {
    scheme: url.protocol === 'https:' ? 'https' : 'http',
    domain,
    pathPrefix: path === '/' ? null : path,
  };
}

/** Каноническая строка адреса для хранения и сравнения правил. */
export function normalizeCustomSiteUrl(raw: string): string | null {
  const rule = parseCustomSiteUrl(raw);
  if (!rule) return null;
  return `${rule.scheme}://${rule.domain}${rule.pathPrefix ?? '/'}`;
}

/** true, если url попадает под правило (домен/поддомены + префикс пути). */
export function ruleMatchesUrl(rule: CustomSiteRule, url: URL): boolean {
  if (url.protocol !== `${rule.scheme}:`) return false;
  const host = url.hostname.toLowerCase();
  if (host !== rule.domain && !host.endsWith(`.${rule.domain}`)) return false;
  if (rule.pathPrefix === null) return true;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return path === rule.pathPrefix || path.startsWith(rule.pathPrefix + '/');
}

export function generateSiteId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `site-${cryptoApi.randomUUID()}`;
  }
  return `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Хостовая часть match-паттерна: wildcard-форма `*.домен` ловит домен и
 * поддомены; IP и одноуровневые имена (localhost) остаются без wildcard.
 */
function hostPartFor(domain: string): string {
  if (domain.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) return domain;
  if (!domain.includes('.')) return domain;
  return `*.${domain}`;
}

/**
 * Паттерн origin для запроса host permission: всегда покрывает весь хост
 * правила (путь в правах доступа не ограничивается), wildcard — если возможно.
 */
export function requestPatternForUrl(siteUrl: string): string | null {
  const rule = parseCustomSiteUrl(siteUrl);
  if (!rule) return null;
  return `${rule.scheme}://${hostPartFor(rule.domain)}/*`;
}

/**
 * Паттерны для динамической регистрации content script. Правило с разделом
 * регистрирует и точный путь (`/foo`), и всё ниже (`/foo/*`), чтобы страница
 * раздела без trailing slash тоже получала скрипт.
 */
export function contentScriptMatchesForUrl(siteUrl: string): string[] {
  const rule = parseCustomSiteUrl(siteUrl);
  if (!rule) return [];
  const host = hostPartFor(rule.domain);
  if (rule.pathPrefix === null) return [`${rule.scheme}://${host}/*`];
  return [
    `${rule.scheme}://${host}${rule.pathPrefix}`,
    `${rule.scheme}://${host}${rule.pathPrefix}/*`,
  ];
}
