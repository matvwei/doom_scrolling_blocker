// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OptionsApp from '../entrypoints/options/App';
import { CONFIG_KEY, PENDING_CONFIG_KEY } from '../adapters/storage';
import { getDefaultConfig } from '../core/config';
import { installFakeChrome } from './fakeChrome';

afterEach(() => {
  vi.unstubAllGlobals();
});

function serviceCard(name: string): HTMLElement {
  return screen.getByRole('heading', { name }).closest('section') as HTMLElement;
}

describe('Options page: встроенные сервисы', () => {
  it('рендерит карточки трёх сервисов со значениями по умолчанию', async () => {
    installFakeChrome();

    render(<OptionsApp />);

    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    const youtube = within(serviceCard('YouTube Shorts'));
    expect(youtube.getByLabelText(/Лимит сессии, минут/)).toHaveValue(15);
    expect(youtube.getByLabelText(/Дневной лимит, минут/)).toHaveValue(45);
    expect(youtube.getByLabelText('Действие при исчерпании лимита')).toHaveValue('warning');
    expect(youtube.getByLabelText('Сообщение')).toHaveValue('Хватит doomscrollить. Пора вернуться к делам');
    // Область ограничения YouTube: default — только Shorts.
    expect(youtube.getByRole('radio', { name: 'Только Shorts' })).toBeChecked();
    expect(youtube.getByRole('radio', { name: /Весь YouTube/ })).not.toBeChecked();

    expect(serviceCard('Instagram Reels')).toBeInTheDocument();
    expect(serviceCard('TikTok')).toBeInTheDocument();
  });

  it('подписывает нулевые лимиты как «0 — блокировать сразу»', async () => {
    installFakeChrome();

    render(<OptionsApp />);

    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });
    expect(screen.getAllByLabelText(/0 — блокировать сразу/).length).toBeGreaterThanOrEqual(6);
  });

  it('сохраняет валидную конфигурацию', async () => {
    const fake = installFakeChrome();
    const user = userEvent.setup();

    render(<OptionsApp />);

    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    const saveButton = await screen.findByRole('button', { name: 'Сохранить' });
    await user.click(saveButton);

    expect(await screen.findByText('Сохранено')).toBeInTheDocument();
    expect(fake.data.get(CONFIG_KEY)).toEqual(getDefaultConfig());
  });

  it('показывает ошибку валидации лимита сессии и не сохраняет', async () => {
    const fake = installFakeChrome();
    const user = userEvent.setup();

    render(<OptionsApp />);

    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    const youtube = within(serviceCard('YouTube Shorts'));
    const sessionInput = await youtube.findByLabelText(/Лимит сессии, минут/);
    await user.clear(sessionInput);
    await user.type(sessionInput, '-1');

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText(/Лимит сессии: целое число/)).toBeInTheDocument();
    expect(fake.data.has(CONFIG_KEY)).toBe(false);
  });

  it('принимает нулевые лимиты (0 — блокировать сразу) и сохраняет', async () => {
    const fake = installFakeChrome();
    const user = userEvent.setup();

    render(<OptionsApp />);

    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    const youtube = within(serviceCard('YouTube Shorts'));
    const sessionInput = await youtube.findByLabelText(/Лимит сессии, минут/);
    await user.clear(sessionInput);
    await user.type(sessionInput, '0');

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Сохранено')).toBeInTheDocument();
    const saved = fake.data.get(CONFIG_KEY) as ReturnType<typeof getDefaultConfig>;
    expect(saved.services.youtube.sessionLimitMinutes).toBe(0);
  });

  it('требует URL для действия «Перенаправление»', async () => {
    const fake = installFakeChrome();
    const user = userEvent.setup();

    render(<OptionsApp />);

    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    const tiktok = within(serviceCard('TikTok'));
    await user.selectOptions(
      await tiktok.findByLabelText('Действие при исчерпании лимита'),
      'redirect',
    );

    // Поле URL появляется и пустое.
    expect(tiktok.getByLabelText('URL перенаправления')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('URL обязателен для действия «Перенаправление»')).toBeInTheDocument();
    expect(fake.data.has(CONFIG_KEY)).toBe(false);
  });

  it('принимает корректный URL перенаправления и сохраняет', async () => {
    const fake = installFakeChrome();
    const user = userEvent.setup();

    render(<OptionsApp />);

    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    const instagram = within(serviceCard('Instagram Reels'));
    await user.selectOptions(
      await instagram.findByLabelText('Действие при исчерпании лимита'),
      'redirect',
    );
    await user.type(
      instagram.getByLabelText('URL перенаправления'),
      'https://example.com/work',
    );

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Сохранено')).toBeInTheDocument();
    const saved = fake.data.get(CONFIG_KEY) as ReturnType<typeof getDefaultConfig>;
    expect(saved.services.instagram.action).toBe('redirect');
    expect(saved.services.instagram.redirectUrl).toBe('https://example.com/work');
  });

  it('сохраняет область «Весь YouTube»', async () => {
    const fake = installFakeChrome();
    const user = userEvent.setup();

    render(<OptionsApp />);

    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    await user.click(screen.getByRole('radio', { name: /Весь YouTube/ }));

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Сохранено')).toBeInTheDocument();
    const saved = fake.data.get(CONFIG_KEY) as ReturnType<typeof getDefaultConfig>;
    expect(saved.youtubeScope).toBe('all');
  });

  it('сброс возвращает значения по умолчанию', async () => {
    const user = userEvent.setup();
    installFakeChrome();

    render(<OptionsApp />);

    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    const youtube = within(serviceCard('YouTube Shorts'));
    const sessionInput = await youtube.findByLabelText(/Лимит сессии, минут/);
    await user.clear(sessionInput);
    await user.type(sessionInput, '33');
    expect(sessionInput).toHaveValue(33);

    await user.click(screen.getByRole('button', { name: 'Сбросить к значениям по умолчанию' }));

    await waitFor(() => {
      expect(sessionInput).toHaveValue(15);
    });
  });
});

describe('Options page: пользовательские сайты', () => {
  async function addSite(user: ReturnType<typeof userEvent.setup>, name: string, url: string) {
    await user.type(await screen.findByLabelText('Название нового сайта'), name);
    await user.type(screen.getByLabelText('Адрес нового сайта (URL)'), url);
    await user.click(screen.getByRole('button', { name: 'Добавить сайт' }));
  }

  it('добавление сайта без JSON: имя + URL, разрешение запрошено, сайт сохранён', async () => {
    const fake = installFakeChrome();
    const user = userEvent.setup();

    render(<OptionsApp />);
    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    await addSite(user, 'Новостная лента', 'https://news.example.com/');
    // Карточка сайта появилась с настройками по умолчанию.
    const card = within(serviceCard('Новостная лента'));
    expect(card.getByLabelText(/Лимит сессии, минут/)).toHaveValue(15);

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Сохранено')).toBeInTheDocument();
    expect(fake.permissions.request).not.toHaveBeenCalled(); // contains=true — право уже выдано
    const saved = fake.data.get(CONFIG_KEY) as ReturnType<typeof getDefaultConfig>;
    expect(saved.customSites).toHaveLength(1);
    expect(saved.customSites[0]!.name).toBe('Новостная лента');
    expect(saved.customSites[0]!.url).toBe('https://news.example.com/');
  });

  it('при недостающем разрешении запрашивает его; при отказе не сохраняет и показывает ошибку', async () => {
    const fake = installFakeChrome();
    fake.permissions.contains.mockResolvedValue(false);
    fake.permissions.request.mockResolvedValue(false);
    const user = userEvent.setup();

    render(<OptionsApp />);
    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    await addSite(user, 'Отклонённый', 'https://deny.example.com/');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(fake.permissions.request).toHaveBeenCalledWith({ origins: ['https://*.deny.example.com/*'] });
    expect(await screen.findByText(/Доступ к добавленным сайтам не подтверждён/)).toBeInTheDocument();
    expect(fake.data.has(CONFIG_KEY)).toBe(false); // сайт не добавлен
    // Черновик сохранён: при повторном открытии настройки его восстановят.
    expect(fake.data.has(PENDING_CONFIG_KEY)).toBe(true);
  });

  it('при принятом запросе сохраняет сайт', async () => {
    const fake = installFakeChrome();
    fake.permissions.contains.mockResolvedValue(false);
    fake.permissions.request.mockResolvedValue(true);
    const user = userEvent.setup();

    render(<OptionsApp />);
    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    await addSite(user, 'Разрешённый', 'https://allow.example.com/');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Сохранено')).toBeInTheDocument();
    const saved = fake.data.get(CONFIG_KEY) as ReturnType<typeof getDefaultConfig>;
    expect(saved.customSites).toHaveLength(1);
  });

  it('не даёт добавить дубликат адреса и показывает ошибку', async () => {
    const fake = installFakeChrome();
    const user = userEvent.setup();

    render(<OptionsApp />);
    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    await addSite(user, 'Первый', 'https://dup.example.com/');
    await addSite(user, 'Второй', 'https://DUP.example.com/');

    expect(await screen.findByText('Такой сайт уже добавлен')).toBeInTheDocument();
    expect(fake.data.has(CONFIG_KEY)).toBe(false);
  });

  it('не даёт добавить некорректный адрес', async () => {
    installFakeChrome();
    const user = userEvent.setup();

    render(<OptionsApp />);
    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    await addSite(user, 'Плохой', 'javascript:alert(1)');

    expect(await screen.findByText(/Адрес должен быть в формате/)).toBeInTheDocument();
  });

  it('удаление с подтверждением убирает сайт из сохранения', async () => {
    const fake = installFakeChrome();
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<OptionsApp />);
    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    await addSite(user, 'На удаление', 'https://trash.example.com/');
    await user.click(screen.getByRole('button', { name: 'Удалить сайт' }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'На удаление' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Сохранено')).toBeInTheDocument();
    const saved = fake.data.get(CONFIG_KEY) as ReturnType<typeof getDefaultConfig>;
    expect(saved.customSites).toHaveLength(0);
  });

  it('отмена в подтверждении удаления оставляет сайт', async () => {
    installFakeChrome();
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<OptionsApp />);
    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    await addSite(user, 'Остающийся', 'https://stay.example.com/');
    await user.click(screen.getByRole('button', { name: 'Удалить сайт' }));

    expect(screen.getByRole('heading', { name: 'Остающийся' })).toBeInTheDocument();
  });

  it('поддерживает несколько сайтов: каждый редактируется независимо', async () => {
    const fake = installFakeChrome();
    const user = userEvent.setup();

    render(<OptionsApp />);
    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    await addSite(user, 'Сайт А', 'https://a.example.com/');
    await addSite(user, 'Сайт Б', 'https://b.example.com/news');

    const cardA = within(serviceCard('Сайт А'));
    const sessionA = cardA.getByLabelText(/Лимит сессии, минут/);
    await user.clear(sessionA);
    await user.type(sessionA, '0');
    const cardB = within(serviceCard('Сайт Б'));
    await user.selectOptions(cardB.getByLabelText('Действие при исчерпании лимита'), 'close');

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Сохранено')).toBeInTheDocument();
    const saved = fake.data.get(CONFIG_KEY) as ReturnType<typeof getDefaultConfig>;
    expect(saved.customSites).toHaveLength(2);
    const siteA = saved.customSites.find((s) => s.name === 'Сайт А')!;
    const siteB = saved.customSites.find((s) => s.name === 'Сайт Б')!;
    expect(siteA.sessionLimitMinutes).toBe(0);
    expect(siteB.action).toBe('close');
    expect(siteB.sessionLimitMinutes).toBe(15);
  });

  it('редактирование адреса сохраняется (перезапрос разрешения на сохранении)', async () => {
    const fake = installFakeChrome();
    fake.permissions.contains.mockResolvedValue(false);
    fake.permissions.request.mockResolvedValue(true);
    const user = userEvent.setup();

    render(<OptionsApp />);
    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    await addSite(user, 'Смена адреса', 'https://old.example.com/');
    const card = within(serviceCard('Смена адреса'));
    const urlInput = card.getByLabelText(/Адрес сайта \(URL\)/);
    await user.clear(urlInput);
    await user.type(urlInput, 'https://new.example.net/section');

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Сохранено')).toBeInTheDocument();
    // Запрошено разрешение нового origin.
    expect(fake.permissions.request).toHaveBeenCalledWith({ origins: ['https://*.new.example.net/*'] });
    const saved = fake.data.get(CONFIG_KEY) as ReturnType<typeof getDefaultConfig>;
    expect(saved.customSites[0]!.url).toBe('https://new.example.net/section');
  });

  it('не даёт сохранить дубликат адреса через редактирование карточки', async () => {
    const fake = installFakeChrome();
    const user = userEvent.setup();

    render(<OptionsApp />);
    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    await addSite(user, 'Сайт А', 'https://shared.example.com/');
    await addSite(user, 'Сайт Б', 'https://other.example.com/');

    const cardB = within(serviceCard('Сайт Б'));
    const urlInput = cardB.getByLabelText(/Адрес сайта \(URL\)/);
    await user.clear(urlInput);
    // Другой регистр и без trailing slash — та же нормализация, что при добавлении.
    await user.type(urlInput, 'https://SHARED.example.com');

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Такой сайт уже добавлен')).toBeInTheDocument();
    expect(fake.data.has(CONFIG_KEY)).toBe(false); // конфликтное изменение не сохранено
  });

  it('разные разделы одного домена можно редактировать и сохранять', async () => {
    const fake = installFakeChrome();
    const user = userEvent.setup();

    render(<OptionsApp />);
    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    await addSite(user, 'Новости', 'https://example.com/news');
    await addSite(user, 'Спорт', 'https://example.com/');

    const sportCard = within(serviceCard('Спорт'));
    const urlInput = sportCard.getByLabelText(/Адрес сайта \(URL\)/);
    await user.clear(urlInput);
    await user.type(urlInput, 'https://example.com/sport');

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Сохранено')).toBeInTheDocument();
    const saved = fake.data.get(CONFIG_KEY) as ReturnType<typeof getDefaultConfig>;
    expect(saved.customSites.map((s) => s.url).sort()).toEqual([
      'https://example.com/news',
      'https://example.com/sport',
    ]);
  });
});

describe('Options page: прерванное сохранение (черновик)', () => {
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

  it('черновик с уже выданными разрешениями автоматически сохраняется при открытии', async () => {
    const fake = installFakeChrome({ [PENDING_CONFIG_KEY]: draftWithSite() });

    render(<OptionsApp />);
    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    // Доступ к домену уже выдан — сохранение достроилось само.
    expect(await screen.findByText('Сохранено')).toBeInTheDocument();
    expect(fake.data.get(CONFIG_KEY)).toEqual(draftWithSite());
    expect(fake.data.has(PENDING_CONFIG_KEY)).toBe(false);
    // Восстановленная форма отражает черновик.
    const youtube = within(serviceCard('YouTube Shorts'));
    expect(youtube.getByLabelText(/Лимит сессии, минут/)).toHaveValue(33);
  });

  it('черновик без подтверждённого доступа восстанавливает форму с пояснением', async () => {
    const fake = installFakeChrome({ [PENDING_CONFIG_KEY]: draftWithSite() });
    fake.permissions.contains.mockResolvedValue(false);

    render(<OptionsApp />);
    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    // Конфиг не сохранён, но введённые данные не потеряны: форма из черновика.
    expect(await screen.findByText(/Сохранение было прервано запросом доступа/)).toBeInTheDocument();
    expect(fake.data.has(CONFIG_KEY)).toBe(false);
    expect(fake.data.has(PENDING_CONFIG_KEY)).toBe(true);
    expect(within(serviceCard('YouTube Shorts')).getByLabelText(/Лимит сессии, минут/)).toHaveValue(33);
  });
});

describe('Options page: повреждённый черновик (DEFECT-6)', () => {
  it('черновик с services:{} не падает, очищается и не применяется', async () => {
    const fake = installFakeChrome({
      [PENDING_CONFIG_KEY]: { version: 2, youtubeScope: 'shorts', services: {}, customSites: [] },
    });

    render(<OptionsApp />);
    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });
    await screen.findByLabelText('Название нового сайта');

    // Без crash: форма открылась от обычного config (дефолт), не от черновика.
    expect(within(serviceCard('YouTube Shorts')).getByLabelText(/Лимит сессии, минут/)).toHaveValue(15);
    // Повреждённый черновик гарантированно очищен и не применён.
    expect(fake.data.has(PENDING_CONFIG_KEY)).toBe(false);
    expect(fake.data.has(CONFIG_KEY)).toBe(false);
  });

  it('мусорный черновик (невалидные значения) очищается без crash', async () => {
    const fake = installFakeChrome({
      [PENDING_CONFIG_KEY]: {
        version: 2,
        youtubeScope: 'shorts',
        services: {
          youtube: {
            enabled: true,
            sessionLimitMinutes: 15,
            dailyLimitMinutes: 45,
            action: 'redirect',
            redirectUrl: 5, // не строка — validateConfig упал бы с TypeError
            message: 'm',
          },
        },
        customSites: [{ junk: true }],
      },
    });

    render(<OptionsApp />);
    await screen.findByRole('heading', { name: 'Настройки Doomscroll Blocker' });

    expect(fake.data.has(PENDING_CONFIG_KEY)).toBe(false); // очищен
    expect(fake.data.has(CONFIG_KEY)).toBe(false); // и не применён
  });
});
