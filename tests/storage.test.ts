import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIG_KEY,
  PENDING_CONFIG_KEY,
  STATE_KEY,
  loadConfig,
  loadState,
  saveConfig,
  saveState,
} from '../adapters/storage';
import { isResumablePendingConfig, tryResumePendingConfig } from '../adapters/pendingResume';
import { getDefaultConfig } from '../core/config';
import { localDayKey } from '../core/time';
import { installFakeChrome } from './fakeChrome';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adapters/storage', () => {
  it('возвращает конфиг по умолчанию для пустого хранилища', async () => {
    installFakeChrome();
    expect(await loadConfig()).toEqual(getDefaultConfig());
  });

  it('круговой путь save/load конфигурации', async () => {
    const fake = installFakeChrome();
    const config = getDefaultConfig();
    config.services.youtube.sessionLimitMinutes = 7;
    config.services.tiktok.action = 'redirect';
    config.services.tiktok.redirectUrl = 'https://example.com';

    expect(await saveConfig(config)).toBe(true);
    expect(await loadConfig()).toEqual(config);
    expect(fake.data.get(CONFIG_KEY)).toEqual(config);
  });

  it('нормализует повреждённый конфиг из хранилища', async () => {
    installFakeChrome({ [CONFIG_KEY]: { services: { instagram: { enabled: false, junk: 1 } }, broken: true } });
    const config = await loadConfig();
    expect(config.services.instagram.enabled).toBe(false);
    expect(config.services.instagram.sessionLimitMinutes).toBe(15);
    expect(config.services.youtube).toEqual(getDefaultConfig().services.youtube);
  });

  it('loadState пересчитывает смену дня (дневной счётчик сбрасывается)', async () => {
    const now = new Date('2025-11-10T09:00:00');
    const yesterdayKey = '2025-11-09';
    installFakeChrome({
      [STATE_KEY]: {
        youtube: {
          sessionSeconds: 600,
          dailySeconds: 2400,
          dayKey: yesterdayKey,
          lastTrackedAt: now.getTime(),
          blockedReason: 'daily',
        },
      },
    });

    const state = await loadState(now);
    expect(state.youtube!.dailySeconds).toBe(0);
    expect(state.youtube!.sessionSeconds).toBe(0);
    expect(state.youtube!.dayKey).toBe(localDayKey(now));
    expect(state.youtube!.blockedReason).toBeNull();
    // Неотслеживаемые сервисы получают пустое состояние.
    expect(state.tiktok!.dailySeconds).toBe(0);
  });

  it('loadState пересчитывает 10-минутный сброс сессии (сохранение после перезапуска браузера)', async () => {
    const lastActivity = new Date('2025-11-10T09:00:00').getTime();
    const now = new Date('2025-11-10T09:20:00');
    installFakeChrome({
      [STATE_KEY]: {
        tiktok: {
          sessionSeconds: 500,
          dailySeconds: 500,
          dayKey: localDayKey(now),
          lastTrackedAt: lastActivity,
          blockedReason: null,
        },
      },
    });

    const state = await loadState(now);
    expect(state.tiktok!.sessionSeconds).toBe(0);
    expect(state.tiktok!.dailySeconds).toBe(500);
  });

  it('saveState сохраняет все три сервиса', async () => {
    const fake = installFakeChrome();
    const state = await loadState(new Date('2025-11-10T10:00:00'));
    state.youtube!.sessionSeconds = 42;

    expect(await saveState(state)).toBe(true);
    const raw = fake.data.get(STATE_KEY) as Record<string, { sessionSeconds: number }>;
    expect(raw.youtube?.sessionSeconds).toBe(42);
    expect(raw.tiktok?.sessionSeconds).toBe(0);
  });

  it('saveState сохраняет снапшот: мутация после вызова не попадает в хранилище', async () => {
    const fake = installFakeChrome();
    const state = await loadState(new Date('2025-11-10T10:00:00'));
    state.youtube!.sessionSeconds = 10;

    const pending = saveState(state);
    // Мутация до завершения записи не должна затронуть сохраняемый снапшот.
    state.youtube!.sessionSeconds = 999;
    await pending;

    const raw = fake.data.get(STATE_KEY) as Record<string, { sessionSeconds: number }>;
    expect(raw.youtube?.sessionSeconds).toBe(10);
  });

  it('перекрывающиеся записи не переупорядочиваются: побеждает более новый saveState', async () => {
    const fake = installFakeChrome();
    const first = await loadState(new Date('2025-11-10T10:00:00'));
    first.youtube!.sessionSeconds = 111;
    const firstWrite = saveState(first);

    const second = await loadState(new Date('2025-11-10T10:00:00'));
    second.youtube!.sessionSeconds = 222;
    const secondWrite = saveState(second);

    await Promise.all([firstWrite, secondWrite]);
    const raw = fake.data.get(STATE_KEY) as Record<string, { sessionSeconds: number }>;
    expect(raw.youtube?.sessionSeconds).toBe(222);
  });

  it('loadState с knownTargets сохраняет счётчики custom-сайтов и отбрасывает удалённые ключи', async () => {
    const now = new Date('2025-11-10T10:00:00');
    installFakeChrome({
      [STATE_KEY]: {
        youtube: { sessionSeconds: 100, dailySeconds: 100, dayKey: localDayKey(now), lastTrackedAt: now.getTime(), blockedReason: null },
        'site-alive': { sessionSeconds: 42, dailySeconds: 42, dayKey: localDayKey(now), lastTrackedAt: now.getTime(), blockedReason: null },
        'site-removed': { sessionSeconds: 999, dailySeconds: 999, dayKey: localDayKey(now), lastTrackedAt: now.getTime(), blockedReason: null },
      },
    });

    const state = await loadState(now, ['youtube', 'instagram', 'tiktok', 'site-alive']);
    expect(state['site-alive']!.sessionSeconds).toBe(42);
    // Состояние удалённого сайта не переносится — background персистит без него.
    expect(state['site-removed']).toBeUndefined();
    expect(Object.keys(state).sort()).toEqual(['instagram', 'site-alive', 'tiktok', 'youtube']);
  });

  it('loadState без knownTargets (UI) сохраняет все ключи из хранилища', async () => {
    const now = new Date('2025-11-10T10:00:00');
    installFakeChrome({
      [STATE_KEY]: {
        'site-x': { sessionSeconds: 7, dailySeconds: 7, dayKey: localDayKey(now), lastTrackedAt: now.getTime(), blockedReason: null },
      },
    });
    const state = await loadState(now);
    expect(state['site-x']!.sessionSeconds).toBe(7);
    expect(state.youtube!.sessionSeconds).toBe(0);
  });
});

describe('adapters/storage: семантика свежести черновика (DEFECT-5)', () => {
  function draftWithSite() {
    const draft = getDefaultConfig();
    draft.services.youtube.sessionLimitMinutes = 33;
    draft.customSites.push({
      id: 'site-draft',
      name: 'Черновой сайт',
      url: 'https://draft.example.com/',
      enabled: true,
      sessionLimitMinutes: 15,
      dailyLimitMinutes: 45,
      action: 'warning',
      redirectUrl: '',
      message: 'm',
    });
    return draft;
  }

  it('saveConfig инвалидирует черновик: свежий config не перезапишется stale-резюме', async () => {
    const fake = installFakeChrome({ [PENDING_CONFIG_KEY]: draftWithSite() });
    const config = getDefaultConfig();
    config.services.youtube.enabled = false; // «toggle с dashboard»

    expect(await saveConfig(config)).toBe(true);

    expect(fake.data.get(CONFIG_KEY)).toEqual(config);
    expect(fake.data.has(PENDING_CONFIG_KEY)).toBe(false);
  });

  it('неуспешный saveConfig черновик не трогает', async () => {
    const fake = installFakeChrome({ [PENDING_CONFIG_KEY]: draftWithSite() });
    const brokenStorage = (
      globalThis as unknown as {
        chrome: { storage: { local: { set: (items: Record<string, unknown>) => Promise<void> } } };
      }
    ).chrome.storage.local;
    brokenStorage.set = () => Promise.reject(new Error('quota'));

    expect(await saveConfig(getDefaultConfig())).toBe(false);
    expect(fake.data.has(PENDING_CONFIG_KEY)).toBe(true);
  });
});

describe('adapters/pendingResume', () => {
  function draftWithSite() {
    const draft = getDefaultConfig();
    draft.services.youtube.sessionLimitMinutes = 33;
    draft.customSites.push({
      id: 'site-draft',
      name: 'Черновой сайт',
      url: 'https://draft.example.com/',
      enabled: true,
      sessionLimitMinutes: 15,
      dailyLimitMinutes: 45,
      action: 'warning',
      redirectUrl: '',
      message: 'm',
    });
    return draft;
  }

  it('isResumablePendingConfig принимает well-formed черновик и отбрасывает повреждённые без исключений', () => {
    expect(isResumablePendingConfig(draftWithSite())).toBe(true);
    expect(isResumablePendingConfig(null)).toBe(false);
    expect(isResumablePendingConfig('junk')).toBe(false);
    // DEFECT-6: services без обязательных сервисов — не падает, отбраковывается.
    expect(
      isResumablePendingConfig({ version: 2, youtubeScope: 'shorts', services: {}, customSites: [] }),
    ).toBe(false);
    // Внутренности сервисов не по форме (redirectUrl не строка при redirect).
    const broken = draftWithSite();
    (broken.services.youtube as { redirectUrl: unknown }).redirectUrl = 5;
    broken.services.youtube.action = 'redirect';
    expect(isResumablePendingConfig(broken)).toBe(false);
    // customSites не массив.
    const brokenSites = draftWithSite() as unknown as { customSites: unknown };
    brokenSites.customSites = { junk: 1 };
    expect(isResumablePendingConfig(brokenSites)).toBe(false);
  });

  it('tryResumePendingConfig сохраняет черновик при выданных разрешениях (путь permissions.onAdded)', async () => {
    const fake = installFakeChrome({ [PENDING_CONFIG_KEY]: draftWithSite() });

    expect(await tryResumePendingConfig()).toBe(true);
    // saveConfig сам инвалидирует черновик.
    expect(fake.data.get(CONFIG_KEY)).toEqual(draftWithSite());
    expect(fake.data.has(PENDING_CONFIG_KEY)).toBe(false);
  });

  it('tryResumePendingConfig оставляет черновик, пока доступ не подтверждён', async () => {
    const fake = installFakeChrome({ [PENDING_CONFIG_KEY]: draftWithSite() });
    fake.permissions.contains.mockResolvedValue(false);

    expect(await tryResumePendingConfig()).toBe(false);
    expect(fake.data.has(CONFIG_KEY)).toBe(false);
    expect(fake.data.has(PENDING_CONFIG_KEY)).toBe(true); // ждёт подтверждения
  });

  it('tryResumePendingConfig очищает повреждённый черновик и не падает (DEFECT-6)', async () => {
    const fake = installFakeChrome({
      [PENDING_CONFIG_KEY]: { version: 2, youtubeScope: 'shorts', services: {}, customSites: [] },
    });

    expect(await tryResumePendingConfig()).toBe(false);
    expect(fake.data.has(PENDING_CONFIG_KEY)).toBe(false); // гарантированно очищен
    expect(fake.data.has(CONFIG_KEY)).toBe(false); // и не применён
  });

  it('tryResumePendingConfig не перезаписывает config, сохранённый между чтением и записью', async () => {
    const fake = installFakeChrome({ [PENDING_CONFIG_KEY]: draftWithSite() });
    // Имитация гонки: пока идут contains-проверки, стороннее сохранение
    // config инвалидирует черновик.
    fake.permissions.contains.mockImplementation(async () => {
      await saveConfig(getDefaultConfig());
      return true;
    });

    expect(await tryResumePendingConfig()).toBe(false);
    expect(fake.data.get(CONFIG_KEY)).toEqual(getDefaultConfig()); // свежий config цел
    expect(fake.data.has(PENDING_CONFIG_KEY)).toBe(false);
  });
});
