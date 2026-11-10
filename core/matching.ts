import { parseCustomSiteUrl, ruleMatchesUrl } from './customSites';
import { SERVICE_IDS, SERVICES, type ServiceId } from './services';
import type { CustomSiteConfig, ExtensionConfig, YouTubeScope } from './config';

/** Отслеживаемая цель: встроенный сервис или пользовательский сайт. */
export interface TargetRef {
  id: string;
  kind: 'builtin' | 'custom';
}

type MatchingConfig = Pick<ExtensionConfig, 'youtubeScope' | 'customSites'>;

const SHORTS_ONLY: MatchingConfig = { youtubeScope: 'shorts', customSites: [] };

function classifyBuiltin(url: URL, youtubeScope: YouTubeScope): ServiceId | null {
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname;

  for (const id of SERVICE_IDS) {
    const def = SERVICES[id];
    if (!def.hosts.includes(host)) continue;
    // Область «весь YouTube» отслеживает любую страницу хостов YouTube.
    if (id === 'youtube' && youtubeScope === 'all') return 'youtube';
    if (def.matchesPath(pathname)) return id;
  }
  return null;
}

/**
 * Определяет, к какой отслеживаемой цели относится URL.
 * Пользовательские правила проверяются первыми: явно добавленное правило
 * переопределяет встроенную классификацию (например, custom-правило для
 * youtube.com действует на весь YouTube независимо от встроенной области).
 * Первое совпавшее правило в порядке списка выигрывает.
 * Бросает исключение только на заведомо некорректных строках — вызывающий
 * код передаёт URL вкладки.
 */
export function classifyUrl(rawUrl: string, config: MatchingConfig = SHORTS_ONLY): TargetRef | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  for (const site of config.customSites) {
    const rule = parseCustomSiteUrl(site.url);
    if (rule && ruleMatchesUrl(rule, url)) {
      return { id: site.id, kind: 'custom' };
    }
  }

  const builtin = classifyBuiltin(url, config.youtubeScope);
  return builtin ? { id: builtin, kind: 'builtin' } : null;
}

/** true, если URL ведёт в отслеживаемую зону (запрет redirect в неё). */
export function isTrackedUrl(rawUrl: string, config: MatchingConfig = SHORTS_ONLY): boolean {
  return classifyUrl(rawUrl, config) !== null;
}

/** Предикат отслеживаемости для валидации redirectUrl внутри конфигурации. */
export function makeIsTracked(config: MatchingConfig): (rawUrl: string) => boolean {
  return (rawUrl) => isTrackedUrl(rawUrl, config);
}

export function customSiteRef(site: CustomSiteConfig): TargetRef {
  return { id: site.id, kind: 'custom' };
}
