// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PopupApp from '../entrypoints/popup/App';
import { CONFIG_KEY, STATE_KEY } from '../adapters/storage';
import { getDefaultConfig } from '../core/config';
import type { ServiceState } from '../core/limits';
import { localDayKey } from '../core/time';
import { installFakeChrome } from './fakeChrome';

afterEach(() => {
  vi.unstubAllGlobals();
});

function configWithCustomSites() {
  const config = getDefaultConfig();
  config.youtubeScope = 'all';
  config.customSites.push(
    {
      id: 'site-1',
      name: 'Новостная лента',
      url: 'https://news.example.com/',
      enabled: true,
      sessionLimitMinutes: 10,
      dailyLimitMinutes: 30,
      action: 'warning',
      redirectUrl: '',
      message: 'm',
    },
    {
      id: 'site-2',
      name: 'Выключенный сайт',
      url: 'https://off.example.com/',
      enabled: false,
      sessionLimitMinutes: 15,
      dailyLimitMinutes: 45,
      action: 'warning',
      redirectUrl: '',
      message: 'm',
    },
  );
  return config;
}

function stateWithCustomUsage(): Record<string, ServiceState> {
  const now = Date.now();
  return {
    youtube: { sessionSeconds: 0, dailySeconds: 0, dayKey: localDayKey(now), lastTrackedAt: null, blockedReason: null },
    instagram: { sessionSeconds: 0, dailySeconds: 0, dayKey: localDayKey(now), lastTrackedAt: null, blockedReason: null },
    tiktok: { sessionSeconds: 0, dailySeconds: 0, dayKey: localDayKey(now), lastTrackedAt: null, blockedReason: null },
    'site-1': { sessionSeconds: 300, dailySeconds: 300, dayKey: localDayKey(now), lastTrackedAt: now, blockedReason: null },
  };
}

describe('Popup', () => {
  it('показывает все три сервиса с остатком времени по умолчанию', async () => {
    installFakeChrome();

    render(<PopupApp />);

    expect(await screen.findByText('YouTube Shorts')).toBeInTheDocument();
    expect(screen.getByText('Instagram Reels')).toBeInTheDocument();
    expect(screen.getByText('TikTok')).toBeInTheDocument();

    // Лимиты по умолчанию: 15 минут сессия, 45 минут день.
    const youtubeCard = within(
      screen.getByText('YouTube Shorts').closest('li') as HTMLElement,
    );
    expect(youtubeCard.getByText('15:00')).toBeInTheDocument();
    expect(youtubeCard.getByText('45:00')).toBeInTheDocument();
  });

  it('отражает область «Весь YouTube» в названии сервиса', async () => {
    installFakeChrome({ [CONFIG_KEY]: configWithCustomSites() });

    render(<PopupApp />);

    expect(await screen.findByText('YouTube (весь сайт)')).toBeInTheDocument();
  });

  it('переключение enabled сохраняет конфигурацию', async () => {
    const fake = installFakeChrome();
    const user = userEvent.setup();

    render(<PopupApp />);

    const toggle = await screen.findByRole('checkbox', { name: 'Включить TikTok' });
    await user.click(toggle);

    await waitFor(() => {
      const saved = fake.data.get(CONFIG_KEY) as ReturnType<typeof getDefaultConfig>;
      expect(saved.services.tiktok.enabled).toBe(false);
    });
    expect((fake.data.get(CONFIG_KEY) as ReturnType<typeof getDefaultConfig>).services.youtube.enabled).toBe(true);
  });

  it('показывает custom-сайты со своими счётчиками', async () => {
    installFakeChrome({
      [CONFIG_KEY]: configWithCustomSites(),
      [STATE_KEY]: stateWithCustomUsage(),
    });

    render(<PopupApp />);

    const siteCard = within(
      (await screen.findByText('Новостная лента')).closest('li') as HTMLElement,
    );
    // Лимит 10/30, израсходовано 5 минут.
    expect(siteCard.getByText('05:00')).toBeInTheDocument();
    expect(siteCard.getByText('25:00')).toBeInTheDocument();

    // Выключенный сайт: время не показывается (сессия и день).
    const offCard = within(screen.getByText('Выключенный сайт').closest('li') as HTMLElement);
    expect(offCard.getAllByText('—')).toHaveLength(2);
  });

  it('переключение custom-сайта сохраняет только его enabled', async () => {
    const fake = installFakeChrome({
      [CONFIG_KEY]: configWithCustomSites(),
      [STATE_KEY]: stateWithCustomUsage(),
    });
    const user = userEvent.setup();

    render(<PopupApp />);

    const toggle = await screen.findByRole('checkbox', { name: 'Включить Новостная лента' });
    await user.click(toggle);

    await waitFor(() => {
      const saved = fake.data.get(CONFIG_KEY) as ReturnType<typeof getDefaultConfig>;
      expect(saved.customSites.find((s) => s.id === 'site-1')!.enabled).toBe(false);
      expect(saved.customSites.find((s) => s.id === 'site-2')!.enabled).toBe(false);
    });
    // Built-in не пострадал.
    expect((fake.data.get(CONFIG_KEY) as ReturnType<typeof getDefaultConfig>).services.youtube.enabled).toBe(true);
  });

  it('показывает список из нескольких сайтов без поломки вёрстки', async () => {
    installFakeChrome({
      [CONFIG_KEY]: configWithCustomSites(),
      [STATE_KEY]: stateWithCustomUsage(),
    });

    render(<PopupApp />);

    // Оба сайта на месте вместе с тремя сервисами.
    expect(await screen.findByText('Новостная лента')).toBeInTheDocument();
    expect(screen.getByText('Выключенный сайт')).toBeInTheDocument();
    expect(screen.getByText('YouTube (весь сайт)')).toBeInTheDocument();
    expect(screen.getByText('Instagram Reels')).toBeInTheDocument();
    expect(screen.getByText('TikTok')).toBeInTheDocument();
  });

  it('показывает бейдж блокировки у custom-сайта с исчерпанным лимитом', async () => {
    const state = stateWithCustomUsage();
    state['site-1'] = {
      sessionSeconds: state['site-1']!.sessionSeconds,
      dailySeconds: state['site-1']!.dailySeconds,
      dayKey: state['site-1']!.dayKey,
      lastTrackedAt: state['site-1']!.lastTrackedAt,
      blockedReason: 'session',
    };
    installFakeChrome({ [CONFIG_KEY]: configWithCustomSites(), [STATE_KEY]: state });

    render(<PopupApp />);

    const siteCard = within(
      (await screen.findByText('Новостная лента')).closest('li') as HTMLElement,
    );
    expect(siteCard.getByText('Лимит исчерпан')).toBeInTheDocument();
    // Остаток сессии подсвечен как исчерпанный (5 минут осталось от 10 при latch блокировки).
    expect(siteCard.getByText('05:00')).toBeInTheDocument();
  });

  it('кнопка настроек открывает страницу настроек', async () => {
    const fake = installFakeChrome();
    const user = userEvent.setup();

    render(<PopupApp />);

    const settingsButton = await screen.findByRole('button', { name: 'Настройки' });
    await user.click(settingsButton);

    expect(fake.openOptionsPage).toHaveBeenCalled();
  });
});
