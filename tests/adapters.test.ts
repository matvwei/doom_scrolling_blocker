import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig, type CustomSiteConfig } from '../core/config';
import {
  requestPermissionsForSites,
  removeUnusedSitePermissions,
  sitePermissionPattern,
} from '../adapters/permissions';
import {
  contentScriptIdForSite,
  injectContentScriptIntoTabsMatching,
  syncCustomContentScripts,
  unregisterAllCustomContentScripts,
} from '../adapters/scripting';
import { installFakeChrome } from './fakeChrome';

afterEach(() => {
  vi.unstubAllGlobals();
});

function site(id: string, url: string): CustomSiteConfig {
  return { id, name: id, url, enabled: true, sessionLimitMinutes: 15, dailyLimitMinutes: 45, action: 'warning', redirectUrl: '', message: 'm' };
}

describe('adapters/permissions', () => {
  it('sitePermissionPattern строит wildcard-паттерн для домена', () => {
    expect(sitePermissionPattern(site('s', 'https://example.com/'))).toBe('https://*.example.com/*');
  });

  it('пустой список сайтов не трогает API и разрешён', async () => {
    const fake = installFakeChrome();
    expect(await requestPermissionsForSites([])).toBe(true);
    expect(fake.permissions.request).not.toHaveBeenCalled();
  });

  it('не запрашивает выданные ранее разрешения (contains=true)', async () => {
    const fake = installFakeChrome();
    expect(await requestPermissionsForSites([site('s', 'https://example.com/')])).toBe(true);
    expect(fake.permissions.contains).toHaveBeenCalledWith({ origins: ['https://*.example.com/*'] });
    expect(fake.permissions.request).not.toHaveBeenCalled();
  });

  it('запрашивает недостающие origins одним вызовом из пользовательского действия', async () => {
    const fake = installFakeChrome();
    fake.permissions.contains.mockResolvedValue(false);
    const sites = [site('a', 'https://a.com/'), site('b', 'https://b.com/feed')];
    expect(await requestPermissionsForSites(sites)).toBe(true);
    expect(fake.permissions.request).toHaveBeenCalledTimes(1);
    expect(fake.permissions.request).toHaveBeenCalledWith({
      origins: ['https://*.a.com/*', 'https://*.b.com/*'],
    });
  });

  it('отказ пользователя = false (правило не должно сохраняться)', async () => {
    const fake = installFakeChrome();
    fake.permissions.contains.mockResolvedValue(false);
    fake.permissions.request.mockResolvedValue(false);
    expect(await requestPermissionsForSites([site('a', 'https://a.com/')])).toBe(false);
  });

  it('недоступность API с сайтами = false (не считаем молча активным)', async () => {
    installFakeChrome();
    vi.stubGlobal('chrome', { storage: (globalThis as never as { chrome: { storage: unknown } }).chrome?.storage });
    expect(await requestPermissionsForSites([site('a', 'https://a.com/')])).toBe(false);
  });

  it('removeUnusedSitePermissions отзывает только неиспользуемые origins', async () => {
    const fake = installFakeChrome();
    fake.permissions.getAll.mockResolvedValue({
      permissions: [],
      origins: ['https://*.used.com/*', 'https://*.unused.com/*', 'https://www.youtube.com/*'],
    });
    const config = getDefaultConfig();
    config.customSites.push(site('s', 'https://used.com/'));
    await removeUnusedSitePermissions(config);
    expect(fake.permissions.remove).toHaveBeenCalledTimes(1);
    expect(fake.permissions.remove).toHaveBeenCalledWith({ origins: ['https://*.unused.com/*'] });
  });
});

describe('adapters/scripting', () => {
  it('syncCustomContentScripts регистрирует недостающие скрипты', async () => {
    const fake = installFakeChrome();
    await syncCustomContentScripts([site('s1', 'https://example.com/')]);
    expect(fake.scripting.registerContentScripts).toHaveBeenCalledTimes(1);
    expect(fake.scripting.registerContentScripts).toHaveBeenCalledWith([
      {
        id: 'dsb-custom-s1',
        js: ['content-scripts/content.js'],
        matches: ['https://*.example.com/*'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);
  });

  it('правило с разделом регистрирует точный путь и префикс', async () => {
    const fake = installFakeChrome();
    await syncCustomContentScripts([site('s1', 'https://example.com/foo')]);
    expect(fake.scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({
        matches: ['https://*.example.com/foo', 'https://*.example.com/foo/*'],
      }),
    ]);
  });

  it('не дублирует уже зарегистрированные скрипты (persistAcrossSessions, повторный запуск)', async () => {
    const fake = installFakeChrome();
    fake.scripting.getRegisteredContentScripts.mockResolvedValue([
      { id: 'dsb-custom-s1', matches: ['https://*.example.com/*'] },
    ]);
    await syncCustomContentScripts([site('s1', 'https://example.com/')]);
    expect(fake.scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(fake.scripting.unregisterContentScripts).not.toHaveBeenCalled();
  });

  it('перерегистрирует при расхождении matches (адрес сайта отредактирован)', async () => {
    const fake = installFakeChrome();
    fake.scripting.getRegisteredContentScripts.mockResolvedValue([
      {
        id: 'dsb-custom-s1',
        matches: ['https://*.example.com/*'],
        js: ['content-scripts/content.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);
    await syncCustomContentScripts([site('s1', 'https://example.com/feed')]);
    expect(fake.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['dsb-custom-s1'] });
    expect(fake.scripting.registerContentScripts).toHaveBeenCalledWith([
      {
        id: 'dsb-custom-s1',
        js: ['content-scripts/content.js'],
        matches: ['https://*.example.com/feed', 'https://*.example.com/feed/*'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);
  });

  it('перерегистрирует при расхождении других существенных полей (js/runAt/persist)', async () => {
    const fake = installFakeChrome();
    fake.scripting.getRegisteredContentScripts.mockResolvedValue([
      {
        id: 'dsb-custom-s1',
        matches: ['https://*.example.com/*'],
        js: ['content-scripts/old.js'],
        runAt: 'document_start',
        persistAcrossSessions: false,
      },
    ]);
    await syncCustomContentScripts([site('s1', 'https://example.com/')]);
    expect(fake.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['dsb-custom-s1'] });
    expect(fake.scripting.registerContentScripts).toHaveBeenCalledTimes(1);
  });

  it('считает регистрацию совпадающей при неуказанных полях (дефолты API)', async () => {
    const fake = installFakeChrome();
    fake.scripting.getRegisteredContentScripts.mockResolvedValue([
      // Chrome может не возвращать runAt/persistAcrossSessions, равные дефолтам.
      { id: 'dsb-custom-s1', matches: ['https://*.example.com/*'], js: ['content-scripts/content.js'] },
    ]);
    await syncCustomContentScripts([site('s1', 'https://example.com/')]);
    expect(fake.scripting.unregisterContentScripts).not.toHaveBeenCalled();
    expect(fake.scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  it('ошибка регистрации одного сайта не мешает остальным правилам', async () => {
    const fake = installFakeChrome();
    fake.scripting.registerContentScripts.mockImplementation((scripts) =>
      String(scripts[0].id).includes('bad') ? Promise.reject(new Error('nope')) : Promise.resolve(),
    );
    await syncCustomContentScripts([
      site('bad', 'https://bad.com/'),
      site('good', 'https://good.com/feed'),
    ]);
    // bad: основная попытка + fallback; good: одна успешная попытка.
    expect(fake.scripting.registerContentScripts).toHaveBeenCalledTimes(3);
    const ids = fake.scripting.registerContentScripts.mock.calls.map((call) => call[0][0].id);
    expect(ids).toContain('dsb-custom-good');
    expect(ids.filter((id) => id === 'dsb-custom-bad')).toHaveLength(2);
  });

  it('снимает регистрации удалённых сайтов и сохраняет чужие', async () => {
    const fake = installFakeChrome();
    fake.scripting.getRegisteredContentScripts.mockResolvedValue([
      { id: 'dsb-custom-removed', matches: ['https://*.old.com/*'] },
      { id: 'other-extension-script' },
    ]);
    await syncCustomContentScripts([site('alive', 'https://alive.com/')]);
    expect(fake.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['dsb-custom-removed'] });
    expect(fake.scripting.registerContentScripts).toHaveBeenCalledTimes(1);
    expect(fake.scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'dsb-custom-alive' }),
    ]);
  });

  it('не падает на ошибке duplicate registration и повторяет без точного пути', async () => {
    const fake = installFakeChrome();
    let calls = 0;
    fake.scripting.registerContentScripts.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('Duplicate script ID')) : Promise.resolve();
    });
    await syncCustomContentScripts([site('s1', 'https://example.com/foo')]);
    expect(fake.scripting.registerContentScripts).toHaveBeenCalledTimes(2);
    expect(fake.scripting.registerContentScripts).toHaveBeenLastCalledWith([
      expect.objectContaining({ matches: ['https://*.example.com/foo/*'] }),
    ]);
  });

  it('unregisterAllCustomContentScripts снимает только свои регистрации', async () => {
    const fake = installFakeChrome();
    fake.scripting.getRegisteredContentScripts.mockResolvedValue([
      { id: 'dsb-custom-a' },
      { id: 'someone-else' },
    ]);
    await unregisterAllCustomContentScripts();
    expect(fake.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['dsb-custom-a'] });
  });

  it('injectContentScriptIntoTabsMatching инъецирует только во вкладки без живого скрипта', async () => {
    const fake = installFakeChrome();
    fake.tabs.query.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    fake.tabs.sendMessage.mockImplementation((_tabId: number) =>
      _tabId === 1 ? Promise.resolve() : Promise.reject(new Error('no receiver')),
    );
    await injectContentScriptIntoTabsMatching([site('s1', 'https://example.com/')]);
    expect(fake.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(fake.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 2 },
      files: ['content-scripts/content.js'],
    });
  });

  it('contentScriptIdForSite строит уникальные id по id сайта', () => {
    expect(contentScriptIdForSite('a')).toBe('dsb-custom-a');
    expect(contentScriptIdForSite('a')).not.toBe(contentScriptIdForSite('b'));
  });
});
