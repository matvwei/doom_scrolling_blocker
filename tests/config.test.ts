import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MESSAGE,
  getDefaultConfig,
  getDefaultServiceConfig,
  hasErrors,
  isValidHttpUrl,
  normalizeConfig,
  validateConfig,
  validateCustomSite,
  validateServiceConfig,
  type CustomSiteConfig,
} from '../core/config';
import { makeIsTracked } from '../core/matching';

function customSite(overrides: Partial<CustomSiteConfig> = {}): CustomSiteConfig {
  return {
    id: 'site-1',
    name: 'Тестовый сайт',
    url: 'https://example.com/',
    enabled: true,
    sessionLimitMinutes: 15,
    dailyLimitMinutes: 45,
    action: 'warning',
    redirectUrl: '',
    message: DEFAULT_MESSAGE,
    ...overrides,
  };
}

describe('значения по умолчанию', () => {
  it('соответствуют спецификации', () => {
    const service = getDefaultServiceConfig();
    expect(service).toEqual({
      enabled: true,
      sessionLimitMinutes: 15,
      dailyLimitMinutes: 45,
      action: 'warning',
      redirectUrl: '',
      message: DEFAULT_MESSAGE,
    });
  });

  it('все три сервиса присутствуют в конфигурации', () => {
    const config = getDefaultConfig();
    expect(Object.keys(config.services).sort()).toEqual(['instagram', 'tiktok', 'youtube']);
    expect(config.youtubeScope).toBe('shorts');
    expect(config.customSites).toEqual([]);
    expect(config.version).toBe(2);
    expect(validateConfig(config)).toBeNull();
  });
});

describe('validateServiceConfig', () => {
  it('принимает конфиг по умолчанию без ошибок', () => {
    expect(validateServiceConfig(getDefaultServiceConfig())).toEqual({});
  });

  it('требует URL только для действия redirect', () => {
    const base = getDefaultServiceConfig();
    expect(validateServiceConfig({ ...base, action: 'close' }).redirectUrl).toBeUndefined();
    expect(validateServiceConfig({ ...base, action: 'warning' }).redirectUrl).toBeUndefined();

    const missing = validateServiceConfig({ ...base, action: 'redirect', redirectUrl: '' });
    expect(missing.redirectUrl).toBeTruthy();

    const invalid = validateServiceConfig({ ...base, action: 'redirect', redirectUrl: 'not-a-url' });
    expect(invalid.redirectUrl).toBeTruthy();

    const ftp = validateServiceConfig({ ...base, action: 'redirect', redirectUrl: 'ftp://example.com' });
    expect(ftp.redirectUrl).toBeTruthy();

    const ok = validateServiceConfig({ ...base, action: 'redirect', redirectUrl: 'https://example.com' });
    expect(ok.redirectUrl).toBeUndefined();
  });

  it('отклоняет redirectUrl, ведущий в отслеживаемую зону (защита от цикла)', () => {
    const base = getDefaultServiceConfig();
    const trackedUrls = [
      'https://www.youtube.com/shorts/abc',
      'https://www.youtube.com/shorts',
      'https://m.youtube.com/shorts/abc',
      'https://www.instagram.com/',
      'https://www.instagram.com/reel/abc/',
      'https://www.tiktok.com/',
      'https://www.tiktok.com/@user/video/1',
    ];
    for (const redirectUrl of trackedUrls) {
      const errors = validateServiceConfig({ ...base, action: 'redirect', redirectUrl });
      expect(errors.redirectUrl, `ожидалась ошибка для ${redirectUrl}`).toBeTruthy();
    }

    // Обычный YouTube (область «только Shorts») и прочие сайты — разрешены.
    const watch = validateServiceConfig({ ...base, action: 'redirect', redirectUrl: 'https://www.youtube.com/watch?v=abc' });
    expect(watch.redirectUrl).toBeUndefined();
    const plain = validateServiceConfig({ ...base, action: 'redirect', redirectUrl: 'https://example.com' });
    expect(plain.redirectUrl).toBeUndefined();
  });

  it('учитывает область YouTube и custom-сайты при проверке redirect', () => {
    const base = getDefaultServiceConfig();
    const allYoutube = { ...getDefaultConfig(), youtubeScope: 'all' as const };
    expect(
      validateServiceConfig({ ...base, action: 'redirect', redirectUrl: 'https://www.youtube.com/watch?v=abc' }, makeIsTracked(allYoutube)).redirectUrl,
    ).toBeTruthy();

    const withCustom = getDefaultConfig();
    withCustom.customSites.push(customSite({ url: 'https://social.example.com/' }));
    expect(
      validateServiceConfig({ ...base, action: 'redirect', redirectUrl: 'https://social.example.com/feed' }, makeIsTracked(withCustom)).redirectUrl,
    ).toBeTruthy();
  });

  it('проверяет границы лимитов: 0 допустим (блокировать сразу), отрицательные и дробные — нет', () => {
    const base = getDefaultServiceConfig();
    // 0 — валидно: блокировка сразу при входе.
    expect(validateServiceConfig({ ...base, sessionLimitMinutes: 0 }).sessionLimitMinutes).toBeUndefined();
    expect(validateServiceConfig({ ...base, dailyLimitMinutes: 0 }).dailyLimitMinutes).toBeUndefined();
    expect(validateServiceConfig({ ...base, sessionLimitMinutes: -1 }).sessionLimitMinutes).toBeTruthy();
    expect(validateServiceConfig({ ...base, sessionLimitMinutes: 721 }).sessionLimitMinutes).toBeTruthy();
    expect(validateServiceConfig({ ...base, sessionLimitMinutes: 1.5 }).sessionLimitMinutes).toBeTruthy();
    expect(validateServiceConfig({ ...base, dailyLimitMinutes: -5 }).dailyLimitMinutes).toBeTruthy();
    expect(validateServiceConfig({ ...base, dailyLimitMinutes: 1441 }).dailyLimitMinutes).toBeTruthy();
  });

  it('требует непустое сообщение', () => {
    const base = getDefaultServiceConfig();
    expect(validateServiceConfig({ ...base, message: '   ' }).message).toBeTruthy();
  });

  it('validateConfig возвращает null при отсутствии ошибок и hasErrors работает', () => {
    expect(validateConfig(getDefaultConfig())).toBeNull();
    const broken = getDefaultConfig();
    broken.services.youtube.sessionLimitMinutes = -5;
    const errors = validateConfig(broken);
    expect(errors).not.toBeNull();
    expect(hasErrors(errors ?? {})).toBe(true);
  });
});

describe('validateCustomSite', () => {
  it('принимает корректный сайт без ошибок', () => {
    expect(validateCustomSite(customSite())).toEqual({});
    expect(validateCustomSite(customSite({ url: 'https://example.com/section', sessionLimitMinutes: 0 }))).toEqual({});
  });

  it('требует название', () => {
    expect(validateCustomSite(customSite({ name: '  ' })).name).toBeTruthy();
    expect(validateCustomSite(customSite({ name: 'a'.repeat(101) })).name).toBeTruthy();
  });

  it('валидирует адрес: только http/https, без логина и нестандартного порта', () => {
    expect(validateCustomSite(customSite({ url: '' })).url).toBeTruthy();
    expect(validateCustomSite(customSite({ url: 'example.com' })).url).toBeTruthy();
    expect(validateCustomSite(customSite({ url: 'javascript:alert(1)' })).url).toBeTruthy();
    expect(validateCustomSite(customSite({ url: 'https://user:pass@example.com/' })).url).toBeTruthy();
    expect(validateCustomSite(customSite({ url: 'https://example.com:8080/' })).url).toBeTruthy();
    expect(validateCustomSite(customSite({ url: 'https://example.com:8080/' })).url).toMatch(/http\(s\):\/\/домен/);
    expect(validateCustomSite(customSite({ url: 'https://example.com/path' })).url).toBeUndefined();
  });

  it('наследует проверки общих полей (лимиты, действие, сообщение)', () => {
    expect(validateCustomSite(customSite({ sessionLimitMinutes: -1 })).sessionLimitMinutes).toBeTruthy();
    expect(
      validateCustomSite(customSite({ action: 'redirect', redirectUrl: '' })).redirectUrl,
    ).toBeTruthy();
    expect(validateCustomSite(customSite({ message: '' })).message).toBeTruthy();
  });

  it('validateConfig собирает ошибки custom-сайтов по id', () => {
    const config = getDefaultConfig();
    config.customSites.push(customSite({ id: 'bad-site', url: 'not a url' }));
    const errors = validateConfig(config);
    expect(errors?.customSites?.['bad-site']?.url).toBeTruthy();
  });

  it('отклоняет дубликат адреса между сайтами через редактирование (та же нормализация)', () => {
    const config = getDefaultConfig();
    config.customSites.push(customSite({ id: 'site-a', name: 'А', url: 'https://example.com/' }));
    config.customSites.push(customSite({ id: 'site-b', name: 'Б', url: 'https://EXAMPLE.com' }));

    const errors = validateConfig(config);
    // Нормализация: регистр хоста и trailing slash не спасают от дубликата.
    expect(errors?.customSites?.['site-b']?.url).toBe('Такой сайт уже добавлен');
    expect(errors?.customSites?.['site-a']?.url).toBeUndefined();
    expect(hasErrors(errors ?? {})).toBe(true);
  });

  it('разные разделы одного домена — не дубликат', () => {
    const config = getDefaultConfig();
    config.customSites.push(customSite({ id: 'site-a', name: 'А', url: 'https://example.com/news' }));
    config.customSites.push(customSite({ id: 'site-b', name: 'Б', url: 'https://example.com/sport' }));
    expect(validateConfig(config)).toBeNull();
  });
});

describe('isValidHttpUrl', () => {
  it('принимает только http/https', () => {
    expect(isValidHttpUrl('https://example.com/path?q=1')).toBe(true);
    expect(isValidHttpUrl('http://localhost:3000')).toBe(true);
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('ftp://example.com')).toBe(false);
    expect(isValidHttpUrl('')).toBe(false);
  });
});

describe('normalizeConfig', () => {
  it('возвращает defaults для мусорного входа', () => {
    expect(normalizeConfig(undefined)).toEqual(getDefaultConfig());
    expect(normalizeConfig(null)).toEqual(getDefaultConfig());
    expect(normalizeConfig('string')).toEqual(getDefaultConfig());
    expect(normalizeConfig(42)).toEqual(getDefaultConfig());
  });

  it('подставляет defaults для отсутствующих полей', () => {
    const normalized = normalizeConfig({ services: { tiktok: { sessionLimitMinutes: 5 } } });
    expect(normalized.services.tiktok.sessionLimitMinutes).toBe(5);
    expect(normalized.services.tiktok.dailyLimitMinutes).toBe(45);
    expect(normalized.services.tiktok.enabled).toBe(true);
    expect(normalized.services.youtube).toEqual(getDefaultServiceConfig());
    expect(normalized.youtubeScope).toBe('shorts');
    expect(normalized.customSites).toEqual([]);
  });

  it('миграция MVP (version 1): настройки сохраняются, добавляются новые поля', () => {
    const mvp = {
      version: 1,
      services: {
        youtube: { enabled: false, sessionLimitMinutes: 7, dailyLimitMinutes: 20, action: 'close', redirectUrl: '', message: 'Своё сообщение' },
        instagram: { enabled: true, sessionLimitMinutes: 3, dailyLimitMinutes: 10, action: 'warning', redirectUrl: '', message: 'x' },
        tiktok: { enabled: true, sessionLimitMinutes: 15, dailyLimitMinutes: 45, action: 'warning', redirectUrl: '', message: 'y' },
      },
    };
    const normalized = normalizeConfig(mvp);
    expect(normalized.version).toBe(2);
    expect(normalized.youtubeScope).toBe('shorts');
    expect(normalized.services.youtube.enabled).toBe(false);
    expect(normalized.services.youtube.sessionLimitMinutes).toBe(7);
    expect(normalized.services.youtube.message).toBe('Своё сообщение');
    expect(normalized.services.instagram.sessionLimitMinutes).toBe(3);
    expect(normalized.customSites).toEqual([]);
  });

  it('отбрасывает некорректное действие', () => {
    const normalized = normalizeConfig({
      services: { youtube: { action: 'hack' } },
    });
    expect(normalized.services.youtube.action).toBe('warning');
  });

  it('клэмпит лимиты в допустимые границы (включая 0)', () => {
    const normalized = normalizeConfig({
      services: { youtube: { sessionLimitMinutes: -3, dailyLimitMinutes: 99999 } },
    });
    expect(normalized.services.youtube.sessionLimitMinutes).toBe(0);
    expect(normalized.services.youtube.dailyLimitMinutes).toBe(1440);
  });

  it('нормализует custom-сайты: канонизирует адреса и чинит поля', () => {
    const normalized = normalizeConfig({
      customSites: [
        { id: 's1', name: 'Новости', url: 'https://News.Example.COM/feed/', enabled: false, sessionLimitMinutes: '5', dailyLimitMinutes: 30, action: 'redirect', redirectUrl: 'https://example.com', message: 'мало' },
      ],
    });
    expect(normalized.customSites).toHaveLength(1);
    const site = normalized.customSites[0]!;
    expect(site.url).toBe('https://news.example.com/feed');
    expect(site.name).toBe('Новости');
    expect(site.enabled).toBe(false);
    expect(site.sessionLimitMinutes).toBe(5);
    expect(site.action).toBe('redirect');
  });

  it('отбрасывает custom-сайты с неподходящими адресами и чинит id', () => {
    const normalized = normalizeConfig({
      customSites: [
        { id: 's1', name: 'Плохой', url: 'javascript:evil()' },
        { id: 's1', name: 'Дубликат id', url: 'https://a.com' },
        { id: 's1', name: 'Дубликат id 2', url: 'https://b.com' },
        'мусор',
        null,
      ],
    });
    expect(normalized.customSites).toHaveLength(2);
    expect(normalized.customSites[0]!.name).toBe('Дубликат id');
    expect(normalized.customSites[1]!.name).toBe('Дубликат id 2');
    expect(normalized.customSites[0]!.id).not.toBe(normalized.customSites[1]!.id);
  });

  it('custom-сайт без названия получает имя домена', () => {
    const normalized = normalizeConfig({ customSites: [{ url: 'https://social.example.com/' }] });
    expect(normalized.customSites[0]!.name).toBe('social.example.com');
  });
});
