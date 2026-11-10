import { generateSiteId, normalizeCustomSiteUrl, parseCustomSiteUrl } from './customSites';
import { makeIsTracked } from './matching';
import { SERVICE_IDS, type ServiceId } from './services';

export type LimitAction = 'close' | 'redirect' | 'warning';
export const LIMIT_ACTIONS: readonly LimitAction[] = ['close', 'redirect', 'warning'];

/** Область ограничения YouTube: только Shorts (MVP-поведение) или весь сайт. */
export type YouTubeScope = 'shorts' | 'all';
export const YOUTUBE_SCOPES: readonly YouTubeScope[] = ['shorts', 'all'];

export interface ServiceConfig {
  enabled: boolean;
  sessionLimitMinutes: number;
  dailyLimitMinutes: number;
  action: LimitAction;
  redirectUrl: string;
  message: string;
}

/** Пользовательское правило: собственный сайт/раздел с полным набором настроек. */
export interface CustomSiteConfig extends ServiceConfig {
  id: string;
  /** Понятное имя для UI. */
  name: string;
  /** Адрес правила: http(s)://домен[/раздел] — см. core/customSites.ts. */
  url: string;
}

export interface ExtensionConfig {
  version: 2;
  youtubeScope: YouTubeScope;
  services: Record<ServiceId, ServiceConfig>;
  customSites: CustomSiteConfig[];
}

export const DEFAULT_MESSAGE = 'Хватит doomscrollить. Пора вернуться к делам';

/**
 * Лимиты — целые минуты. 0 допустим и означает «блокировать сразу»:
 * доступного времени нет, действие срабатывает при первом же входе
 * на отслеживаемую страницу, без ожидания накопления активных минут.
 */
export const LIMITS = {
  sessionMin: 0,
  sessionMax: 720,
  dailyMin: 0,
  dailyMax: 1440,
  messageMaxLength: 500,
  siteNameMaxLength: 100,
} as const;

export function getDefaultServiceConfig(): ServiceConfig {
  return {
    enabled: true,
    sessionLimitMinutes: 15,
    dailyLimitMinutes: 45,
    action: 'warning',
    redirectUrl: '',
    message: DEFAULT_MESSAGE,
  };
}

export function getDefaultConfig(): ExtensionConfig {
  return {
    version: 2,
    youtubeScope: 'shorts',
    services: {
      youtube: getDefaultServiceConfig(),
      instagram: getDefaultServiceConfig(),
      tiktok: getDefaultServiceConfig(),
    },
    customSites: [],
  };
}

export function isValidHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export type ServiceConfigErrors = Partial<Record<keyof ServiceConfig, string>>;
export type CustomSiteErrors = ServiceConfigErrors & { name?: string; url?: string };

export interface ConfigErrors {
  services?: Partial<Record<ServiceId, ServiceConfigErrors>>;
  customSites?: Record<string, CustomSiteErrors>;
}

/** Проверка redirectUrl без полной конфигурации: встроенные сервисы в дефолтной области (только Shorts). */
const isBuiltinTrackedDefault = makeIsTracked({ youtubeScope: 'shorts', customSites: [] });

/**
 * Валидирует настройки одной цели (встроенный сервис или custom-сайт —
 * у них одинаковый набор полей). `isTracked` запрещает redirect в
 * отслеживаемую зону любой цели (защита от бесконечного цикла);
 * без него используется встроенная классификация с областью «только Shorts».
 */
export function validateServiceConfig(
  cfg: ServiceConfig,
  isTracked: (rawUrl: string) => boolean = isBuiltinTrackedDefault,
): ServiceConfigErrors {
  const errors: ServiceConfigErrors = {};

  if (typeof cfg.enabled !== 'boolean') {
    errors.enabled = 'Некорректное значение включения';
  }

  if (
    !Number.isFinite(cfg.sessionLimitMinutes) ||
    !Number.isInteger(cfg.sessionLimitMinutes) ||
    cfg.sessionLimitMinutes < LIMITS.sessionMin ||
    cfg.sessionLimitMinutes > LIMITS.sessionMax
  ) {
    errors.sessionLimitMinutes = `Лимит сессии: целое число от ${LIMITS.sessionMin} до ${LIMITS.sessionMax} минут (0 — блокировать сразу)`;
  }

  if (
    !Number.isFinite(cfg.dailyLimitMinutes) ||
    !Number.isInteger(cfg.dailyLimitMinutes) ||
    cfg.dailyLimitMinutes < LIMITS.dailyMin ||
    cfg.dailyLimitMinutes > LIMITS.dailyMax
  ) {
    errors.dailyLimitMinutes = `Дневной лимит: целое число от ${LIMITS.dailyMin} до ${LIMITS.dailyMax} минут (0 — блокировать сразу)`;
  }

  if (!LIMIT_ACTIONS.includes(cfg.action)) {
    errors.action = 'Неизвестное действие';
  }

  if (cfg.action === 'redirect') {
    if (!cfg.redirectUrl.trim()) {
      errors.redirectUrl = 'URL обязателен для действия «Перенаправление»';
    } else if (!isValidHttpUrl(cfg.redirectUrl)) {
      errors.redirectUrl = 'URL должен начинаться с http:// или https://';
    } else if (isTracked(cfg.redirectUrl)) {
      // Иначе перенаправление мгновенно снова попадало бы под блокировку — бесконечный цикл.
      errors.redirectUrl = 'URL не должен вести на отслеживаемую зону (YouTube, Instagram, TikTok или добавленный сайт)';
    }
  }

  if (typeof cfg.message !== 'string' || !cfg.message.trim()) {
    errors.message = 'Сообщение не должно быть пустым';
  } else if (cfg.message.length > LIMITS.messageMaxLength) {
    errors.message = `Сообщение длиннее ${LIMITS.messageMaxLength} символов`;
  }

  return errors;
}

export function validateCustomSite(
  site: CustomSiteConfig,
  isTracked: (rawUrl: string) => boolean = isBuiltinTrackedDefault,
): CustomSiteErrors {
  const errors: CustomSiteErrors = validateServiceConfig(site, isTracked);

  const name = site.name.trim();
  if (!name) {
    errors.name = 'Укажите название сайта';
  } else if (name.length > LIMITS.siteNameMaxLength) {
    errors.name = `Название длиннее ${LIMITS.siteNameMaxLength} символов`;
  }

  if (!site.url.trim()) {
    errors.url = 'Укажите адрес сайта';
  } else if (parseCustomSiteUrl(site.url) === null) {
    errors.url = 'Адрес должен быть в формате http(s)://домен[/раздел] — без логина, пароля и нестандартного порта';
  }

  return errors;
}

export function hasErrors(errors: ConfigErrors): boolean {
  const serviceErrors = Object.values(errors.services ?? {}).some(
    (serviceErrors) => Object.keys(serviceErrors ?? {}).length > 0,
  );
  const customErrors = Object.values(errors.customSites ?? {}).some(
    (siteErrors) => Object.keys(siteErrors ?? {}).length > 0,
  );
  return serviceErrors || customErrors;
}

export function validateConfig(config: ExtensionConfig): ConfigErrors | null {
  const errors: ConfigErrors = {};
  const isTracked = makeIsTracked(config);

  const services: Partial<Record<ServiceId, ServiceConfigErrors>> = {};
  for (const id of SERVICE_IDS) {
    const serviceErrors = validateServiceConfig(config.services[id], isTracked);
    if (Object.keys(serviceErrors).length > 0) {
      services[id] = serviceErrors;
    }
  }
  if (Object.keys(services).length > 0) errors.services = services;

  const customSites: Record<string, CustomSiteErrors> = {};
  const seenUrls = new Map<string, string>(); // нормализованный адрес -> id первого сайта
  for (const site of config.customSites) {
    const siteErrors = validateCustomSite(site, isTracked);

    // Дубликат адреса возможен через редактирование карточки — та же
    // нормализация и сравнение, что при добавлении (см. options).
    const normalized = normalizeCustomSiteUrl(site.url);
    if (normalized) {
      const firstId = seenUrls.get(normalized);
      if (firstId !== undefined && firstId !== site.id) {
        siteErrors.url = 'Такой сайт уже добавлен';
      } else {
        seenUrls.set(normalized, site.id);
      }
    }

    if (Object.keys(siteErrors).length > 0) {
      customSites[site.id] = siteErrors;
    }
  }
  if (Object.keys(customSites).length > 0) errors.customSites = customSites;

  return Object.keys(errors).length > 0 ? errors : null;
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function coerceInteger(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Math.round(Number(value));
  }
  return fallback;
}

function coerceString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function coerceAction(value: unknown, fallback: LimitAction): LimitAction {
  return LIMIT_ACTIONS.includes(value as LimitAction) ? (value as LimitAction) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Приводит произвольные (например, прочитанные из хранилища) custom-сайты
 * к корректному виду: правила с неразбираемым адресом отбрасываются,
 * повреждённые поля — к дефолтам, id дедуплицируются.
 */
function normalizeCustomSites(raw: unknown): CustomSiteConfig[] {
  if (!Array.isArray(raw)) return [];

  const result: CustomSiteConfig[] = [];
  const seenIds = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const rawSite = entry as Record<string, unknown>;
    const url = typeof rawSite.url === 'string' ? normalizeCustomSiteUrl(rawSite.url) : null;
    if (!url) continue;

    let id = coerceString(rawSite.id, '').trim();
    if (!id || seenIds.has(id)) id = generateSiteId();
    seenIds.add(id);

    const rule = parseCustomSiteUrl(url);
    result.push({
      id,
      name: coerceString(rawSite.name, rule?.domain ?? 'Сайт').trim() || (rule?.domain ?? 'Сайт'),
      url,
      enabled: coerceBoolean(rawSite.enabled, true),
      sessionLimitMinutes: clamp(coerceInteger(rawSite.sessionLimitMinutes, 15), LIMITS.sessionMin, LIMITS.sessionMax),
      dailyLimitMinutes: clamp(coerceInteger(rawSite.dailyLimitMinutes, 45), LIMITS.dailyMin, LIMITS.dailyMax),
      action: coerceAction(rawSite.action, 'warning'),
      redirectUrl: coerceString(rawSite.redirectUrl, ''),
      message: coerceString(rawSite.message, DEFAULT_MESSAGE),
    });
  }
  return result;
}

/**
 * Приводит произвольное значение из хранилища к корректной конфигурации.
 * Хранилище MVP (version 1: только services) нормализуется без потерь:
 * добавляются youtubeScope='shorts' (прежнее поведение) и пустой список
 * custom-сайтов; счётчики хранятся отдельно и не затрагиваются.
 */
export function normalizeConfig(raw: unknown): ExtensionConfig {
  const defaults = getDefaultConfig();
  if (typeof raw !== 'object' || raw === null) return defaults;

  const rawConfig = raw as Record<string, unknown>;
  const rawServices = (rawConfig.services ?? {}) as Record<string, unknown>;

  const services = {} as Record<ServiceId, ServiceConfig>;
  for (const id of SERVICE_IDS) {
    const base = defaults.services[id];
    const rawService = (rawServices[id] ?? {}) as Record<string, unknown>;
    services[id] = {
      enabled: coerceBoolean(rawService.enabled, base.enabled),
      sessionLimitMinutes: clamp(
        coerceInteger(rawService.sessionLimitMinutes, base.sessionLimitMinutes),
        LIMITS.sessionMin,
        LIMITS.sessionMax,
      ),
      dailyLimitMinutes: clamp(
        coerceInteger(rawService.dailyLimitMinutes, base.dailyLimitMinutes),
        LIMITS.dailyMin,
        LIMITS.dailyMax,
      ),
      action: coerceAction(rawService.action, base.action),
      redirectUrl: coerceString(rawService.redirectUrl, base.redirectUrl),
      message: coerceString(rawService.message, base.message),
    };
  }

  return {
    version: 2,
    youtubeScope: rawConfig.youtubeScope === 'all' ? 'all' : 'shorts',
    services,
    customSites: normalizeCustomSites(rawConfig.customSites),
  };
}
