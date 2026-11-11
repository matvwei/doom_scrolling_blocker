/**
 * Реальный браузерный E2E: расширение загружается в Chrome/Chromium/Edge,
 * страницы youtube.com и тестового домена doomscroll-e2e.test перехватываются
 * и отдают локальный HTML, так что тест работает без сети.
 *
 * Тестовый origin https://*.doomscroll-e2e.test/* добавляется в host_permissions
 * только в этой e2e-сборке (см. wxt.config.ts, DSB_E2E_ORIGINS): нативный prompt
 * Chrome не кликабелен из автотеста, поэтому путь «право выдано заранее»
 * покрывается здесь, а сценарии request/отказ/duplicate/unregister —
 * юнит-тестами адаптеров и компонентными тестами options.
 *
 * Запуск: npm run test:e2e (сборка e2e-варианта выполняется автоматически).
 *
 * Проверка UI popup (сценарий 5): открывается реальный popup.html в контексте
 * расширения с вьюпортом action-popup; «Настройки» переключают view внутри
 * popup (без новой вкладки/страницы options), форма добавления сайта —
 * одна колонка без горизонтального overflow, add/save custom-сайта работает.
 * Полная страница options дополнительно проверяется в сценариях 4 и 18–19
 * как fallback через chrome://extensions. Сценарии 21–22 — семантика
 * dsb:pendingConfig: свежий config инвалидирует прерванный черновик
 * (DEFECT-5) и нормальный auto-resume после native prompt.
 *
 * Геометрические инварианты UI (все видимые элементы и тексты внутри своих
 * контейнеров, без горизонтального overflow) проверяются в реальном браузере
 * переиспользуемым помощником e2e/geometry.mjs: popup dashboard и настройки
 * (сценарий 5) и страница options fallback (сценарий 23) — включая radio
 * scope YouTube, длинные названия/URL/сообщения и состояния ошибок.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { checkGeometry } from './geometry.mjs';

const EXTENSION_PATH = path.resolve(process.cwd(), '.e2e-output/chrome-mv3');
const E2E_ORIGIN = 'https://*.doomscroll-e2e.test/*';
const CUSTOM_HOST = 'https://doomscroll-e2e.test';
const STATE_KEY = 'dsb:state';
const CONFIG_KEY = 'dsb:config';
const PENDING_CONFIG_KEY = 'dsb:pendingConfig';
const MESSAGE = 'Хватит doomscrollить. Пора вернуться к делам';

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}`);
  }
}

function todayKey() {
  return new Date().toLocaleDateString('sv-SE');
}

function defaultService(overrides = {}) {
  return {
    enabled: true,
    sessionLimitMinutes: 15,
    dailyLimitMinutes: 45,
    action: 'warning',
    redirectUrl: '',
    message: MESSAGE,
    ...overrides,
  };
}

function baseConfig() {
  return {
    version: 2,
    youtubeScope: 'shorts',
    services: {
      youtube: defaultService(),
      instagram: defaultService(),
      tiktok: defaultService(),
    },
    customSites: [],
  };
}

function customSite(id, name, url, overrides = {}) {
  return {
    id,
    name,
    url,
    enabled: true,
    sessionLimitMinutes: 15,
    dailyLimitMinutes: 45,
    action: 'warning',
    redirectUrl: '',
    message: MESSAGE,
    ...overrides,
  };
}

function emptyService() {
  return {
    sessionSeconds: 0,
    dailySeconds: 0,
    dayKey: todayKey(),
    lastTrackedAt: null,
    blockedReason: null,
  };
}

/** Состояние, в котором лимит сессии YouTube (15 мин) уже израсходован. */
function primedYoutubeState() {
  return {
    youtube: {
      sessionSeconds: 15 * 60,
      dailySeconds: 15 * 60,
      dayKey: todayKey(),
      lastTrackedAt: Date.now(),
      blockedReason: null,
    },
    instagram: emptyService(),
    tiktok: emptyService(),
  };
}

function buildE2E() {
  console.log('Сборка e2e-варианта расширения…');
  execSync('npx wxt build', {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, DSB_E2E_ORIGINS: E2E_ORIGIN },
  });
  if (!existsSync(EXTENSION_PATH)) {
    throw new Error(`e2e-сборка не появилась: ${EXTENSION_PATH}`);
  }
}

async function waitForBackgroundWorker(context, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // После chrome.runtime.reload() старый worker может ещё числиться в списке —
    // берём только тот, который реально отвечает.
    for (const candidate of context.serviceWorkers()) {
      if (!candidate.url().includes('background')) continue;
      const alive = await candidate.evaluate(() => true).then(() => true).catch(() => false);
      if (alive) return candidate;
    }
    await context.waitForEvent('serviceworker', { timeout: 1000 }).catch(() => {});
  }
  throw new Error('service worker расширения не появился');
}

/**
 * Запуск браузера с расширением. Branded Chrome ≥139 отключил --load-extension,
 * поэтому порядок такой:
 *  1. bundled Playwright Chromium (принимает --load-extension) — headful;
 *  2. Edge/Chrome с флагом --disable-features=DisableLoadExtensionCommandLineSwitch
 *     (возвращает флаг в Chromium-сборках Microsoft Edge и в Chrome 137–138);
 *  3. те же каналы в headless-режимах (headless shell расширения не грузит,
 *     но новые headless-сборки могут).
 */
async function launchAttempt(userDataDir, channel, headless, extraArgs = []) {
  return chromium.launchPersistentContext(userDataDir, {
    channel,
    headless,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...extraArgs,
    ],
  });
}

async function openExtensionContext(userDataDir) {
  const profileDir = userDataDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'dsb-e2e-')));
  const restoreFlag = '--disable-features=DisableLoadExtensionCommandLineSwitch';
  const channels = [
    { channel: undefined, label: 'bundled chromium', extraArgs: [] },
    { channel: 'msedge', label: 'microsoft edge', extraArgs: [restoreFlag] },
    { channel: 'chrome', label: 'google chrome', extraArgs: [restoreFlag] },
  ];
  const errors = [];
  for (const headless of [false, true]) {
    for (const { channel, label, extraArgs } of channels) {
      let context = null;
      try {
        context = await launchAttempt(userDataDir, channel, headless, extraArgs);
        const worker = await waitForBackgroundWorker(context, 12000);
        console.log(`Браузер: ${label}, headless=${headless}`);
        return { context, worker };
      } catch (error) {
        errors.push(`${label} (headless=${headless}): ${String(error).split('\n')[0]}`);
        await context?.close().catch(() => {});
      }
    }
  }
  throw new Error(`Не удалось запустить браузер с расширением:\n  ${errors.join('\n  ')}`);
}

async function main() {
  buildE2E();

  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsb-e2e-'));
  let { context } = await openExtensionContext(userDataDir);
  let worker = await waitForBackgroundWorker(context);

  try {
    const extensionId = await worker.evaluate(() => chrome.runtime.id);
    console.log(`Расширение загружено: ${extensionId}`);

    // Якорная вкладка: браузер не должен закрываться, когда сценарий
    // автоматически закрывает последнюю content-вкладку (действие close).
    const anchorPage = await context.newPage();

    const writeConfig = (config) =>
      worker.evaluate(
        ([key, value]) => chrome.storage.local.set({ [key]: value }).then(() => true),
        [CONFIG_KEY, config],
      );
    const writeState = (state) =>
      worker.evaluate(
        ([key, value]) => chrome.storage.local.set({ [key]: value }).then(() => true),
        [STATE_KEY, state],
      );
    const readStoredState = () =>
      worker
        .evaluate(([key]) => chrome.storage.local.get(key).then((d) => d[key]), [STATE_KEY])
        .catch(() => null);
    const readStoredConfig = () =>
      worker
        .evaluate(([key]) => chrome.storage.local.get(key).then((d) => d[key]), [CONFIG_KEY])
        .catch(() => null);
    const readCustomScripts = () =>
      worker
        .evaluate(() => chrome.scripting.getRegisteredContentScripts())
        .then((scripts) => scripts.map((script) => script.id))
        .catch(() => []);
    /** Регистрации custom content scripts с их matches — для проверки reconcile. */
    const readCustomRegistrations = () =>
      worker
        .evaluate(() =>
          chrome.scripting
            .getRegisteredContentScripts()
            .then((scripts) =>
              scripts
                .filter((script) => script.id.startsWith('dsb-custom-'))
                .map((script) => ({ id: script.id, matches: script.matches ?? [] })),
            ),
        )
        .catch(() => []);

    /** Ждёт, пока background не сбросит состояние в хранилище (троттл 5 с). */
    async function waitForStoredBlockedReason(targetId, timeoutMs = 10000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const state = await readStoredState();
        if (state?.[targetId]?.blockedReason) return state[targetId].blockedReason;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return null;
    }

    /** Пишет конфиг/состояние и перезапускает браузер с тем же профилем —
     * как реальный перезапуск браузера. chrome.runtime.reload() нельзя:
     * расширение, загруженное через --load-extension, после него не возвращается. */
    async function primeAndReload(config, state) {
      await writeConfig(config);
      await writeState(state);
      await context.close().catch(() => {});
      ({ context, worker } = await openExtensionContext(userDataDir));
      worker = await waitForBackgroundWorker(context);
      // Якорная вкладка нового контекста: браузер не должен закрываться,
      // когда сценарий автоматически закрывает последнюю content-вкладку.
      await context.newPage();
      return worker;
    }

    async function openFakePage(url) {
      const page = await context.newPage();
      await page.route('**/*', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html><head><title>fake</title></head><body><h1>fake video page</h1></body></html>',
        }),
      );
      // Расширение может закрыть или перенаправить вкладку ещё во время
      // навигации (enforcement) — это штатно, ошибку goto игнорируем.
      await page.goto(url).catch(() => {});
      return page;
    }

    async function overlayTextOf(page) {
      return page
        .locator('#dsb-overlay-host')
        .evaluate((el) => el.shadowRoot?.textContent ?? '')
        .catch(() => '');
    }

    console.log('\nСценарий 1: warning overlay на /shorts/ после исчерпания лимита');
    await primeAndReload(baseConfig(), primedYoutubeState());
    const shortsPage = await openFakePage('https://www.youtube.com/shorts/e2e-video');

    const overlayHost = shortsPage.locator('#dsb-overlay-host');
    await overlayHost.waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    check('overlay появился на странице Shorts', (await overlayHost.count()) === 1);

    const overlayText = await overlayTextOf(shortsPage);
    check('overlay содержит название сервиса', overlayText.includes('YouTube Shorts'));
    check('overlay содержит причину (лимит сессии)', overlayText.includes('Лимит сессии'));
    check('overlay содержит пользовательское сообщение', overlayText.includes(MESSAGE));
    check('overlay безопасен для HTML в сообщении', !overlayText.includes('<script'));
    const closeButton = shortsPage.getByRole('button', { name: 'Закрыть вкладку' });
    check('есть кнопка закрытия вкладки', (await closeButton.count()) === 1);
    check(
      'нет кнопки перехода без redirectUrl',
      (await shortsPage.getByRole('button', { name: 'Перейти' }).count()) === 0,
    );

    const blockedReason = await waitForStoredBlockedReason('youtube');
    check(
      'блокировка записана в состояние (переживает перезапуск)',
      blockedReason === 'session',
    );

    const pagesBefore = context.pages().length;
    await closeButton.click();
    await shortsPage.waitForEvent('close', { timeout: 5000 }).catch(() => {});
    check('кнопка закрывает вкладку', context.pages().length < pagesBefore);

    console.log('\nСценарий 2: обычный YouTube не отслеживается и не блокируется');
    await primeAndReload(baseConfig(), primedYoutubeState());
    const watchPage = await openFakePage('https://www.youtube.com/watch?v=e2e');
    await watchPage.waitForTimeout(3000);
    check('overlay не появился на обычном YouTube', (await watchPage.locator('#dsb-overlay-host').count()) === 0);
    const stateOnWatch = await readStoredState();
    check(
      'счётчик YouTube не растёт на обычном YouTube',
      stateOnWatch?.youtube?.sessionSeconds === 15 * 60 && stateOnWatch?.youtube?.blockedReason === null,
    );
    check('вкладка осталась открытой', !watchPage.isClosed());
    await watchPage.close();

    console.log('\nСценарий 3: действие close автоматически закрывает вкладку Shorts');
    const closeConfig = baseConfig();
    closeConfig.services.youtube = defaultService({ action: 'close' });
    await primeAndReload(closeConfig, primedYoutubeState());
    const shortsPage2 = await openFakePage('https://www.youtube.com/shorts/close-test');
    await shortsPage2.waitForEvent('close', { timeout: 15000 }).catch(() => {});
    check('вкладка Shorts закрыта автоматически', shortsPage2.isClosed());

    console.log('\nСценарий 4: options page сохраняет настройки без переустановки');
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    const tiktokCard = optionsPage.locator('section', {
      has: optionsPage.getByRole('heading', { name: 'TikTok' }),
    });
    await tiktokCard.getByLabel(/Лимит сессии, минут/).fill('9');
    await optionsPage.getByRole('button', { name: 'Сохранить' }).click();
    await optionsPage
      .getByText('Сохранено')
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => check('показано подтверждение сохранения', true))
      .catch(() => check('показано подтверждение сохранения', false));
    const persisted = await worker.evaluate(
      ([key]) => chrome.storage.local.get(key).then((d) => d[key]?.services?.tiktok?.sessionLimitMinutes),
      [CONFIG_KEY],
    );
    check('лимит TikTok (9 минут) виден в background сразу после сохранения', persisted === 9);
    await optionsPage.close();

    console.log('\nСценарий 5: popup — dashboard, настройки внутри popup, custom add/save, layout');
    const popupPage = await context.newPage();
    // Вьюпорт как у реального action-popup (конент 360px): проверяем,
    // что вёрстка держит узкое окно без горизонтального переполнения.
    await popupPage.setViewportSize({ width: 400, height: 600 });
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    check('popup показывает TikTok', await popupPage.getByText('TikTok').isVisible());
    check('popup показывает Instagram Reels', await popupPage.getByText('Instagram Reels').isVisible());
    check(
      'popup показывает остаток по лимиту сессии (9 минут)',
      await popupPage.getByText('09:00').isVisible(),
    );
    await checkGeometry(
      check,
      'popup dashboard: элементы и тексты внутри контейнеров, без overflow',
      popupPage,
    );

    // «Настройки» открывают настройки ВНУТРИ popup — без новой вкладки/страницы.
    const pagesBeforeSettings = context.pages().length;
    await popupPage.getByRole('button', { name: 'Настройки' }).click();
    await popupPage
      .getByRole('button', { name: 'Назад' })
      .waitFor({ state: 'visible', timeout: 5000 })
      .catch(() => {});
    check(
      'настройки открылись внутри popup (заголовок и кнопка «Назад»)',
      (await popupPage.getByRole('heading', { name: 'Настройки' }).count()) === 1 &&
        (await popupPage.getByRole('button', { name: 'Назад' }).count()) === 1,
    );
    check(
      'новая вкладка/страница не открыта',
      context.pages().length === pagesBeforeSettings &&
        !context.pages().some((p) => p.url().includes('options.html')),
    );
    await checkGeometry(
      check,
      'popup-настройки: геометрия по умолчанию (карточки, radio scope YouTube, add-form)',
      popupPage,
    );

    // Layout формы добавления сайта: одна колонка с общими границами,
    // нет горизонтального overflow, длинные значения не ломают вёрстку.
    const longName = `Очень длинное название новостного сайта ${'для проверки переноса '.repeat(6)}`.trim();
    const longUrl = `https://doomscroll-e2e.test/${'a'.repeat(200)}`;
    await popupPage.getByLabel('Название нового сайта').fill(longName);
    await popupPage.getByLabel('Адрес нового сайта (URL)').fill(longUrl);
    const layout = await popupPage.evaluate(() => {
      const doc = document.documentElement;
      const form = document.querySelector('.add-site');
      if (!form) return null;
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top };
      };
      return {
        docScrollWidth: doc.scrollWidth,
        docClientWidth: doc.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        children: [...form.children].map(rect),
        fieldBlocks: [...form.querySelectorAll(':scope > .field')].map(rect),
      };
    });
    check('форма добавления сайта присутствует в popup-настройках', layout !== null);
    if (layout) {
      const EPS = 1;
      const sameLeft = layout.children.every(
        (r) => Math.abs(r.left - layout.children[0].left) <= EPS,
      );
      const sequentialY = layout.children.every(
        (r, i) => i === 0 || r.top > layout.children[i - 1].top - EPS,
      );
      const sameColumn =
        layout.fieldBlocks.length > 0 &&
        layout.fieldBlocks.every(
          (r) =>
            Math.abs(r.left - layout.fieldBlocks[0].left) <= EPS &&
            Math.abs(r.right - layout.fieldBlocks[0].right) <= EPS,
        );
      const noHOverflow =
        layout.docScrollWidth <= layout.docClientWidth &&
        layout.bodyScrollWidth <= layout.docClientWidth;
      check('все контролы формы выровнены по левому краю одной колонки', sameLeft);
      check('контролы формы идут строго друг под другом (последовательные Y)', sequentialY);
      check('поля формы имеют общие левую и правую границы колонки', sameColumn);
      check('нет горизонтального overflow (scrollWidth <= clientWidth)', noHOverflow);
    }
    await checkGeometry(
      check,
      'popup-настройки: геометрия с длинными названием/URL в add-form',
      popupPage,
    );

    // Состояние ошибки добавления: текст ошибки тоже остаётся внутри контейнеров.
    await popupPage.getByLabel('Название нового сайта').fill('');
    await popupPage.getByLabel('Адрес нового сайта (URL)').fill('не-url');
    await popupPage.getByRole('button', { name: 'Добавить сайт' }).click();
    await popupPage
      .getByText('Укажите название сайта')
      .waitFor({ state: 'visible', timeout: 5000 })
      .catch(() => {});
    await checkGeometry(
      check,
      'popup-настройки: геометрия с ошибкой добавления сайта',
      popupPage,
    );

    // Custom-сайт через UI popup: добавление и сохранение (доступ к тестовому
    // origin предвыдан в e2e-сборке, prompt не появляется).
    await popupPage.getByLabel('Название нового сайта').fill('Popup Site');
    await popupPage.getByLabel('Адрес нового сайта (URL)').fill(CUSTOM_HOST);
    await popupPage.getByRole('button', { name: 'Добавить сайт' }).click();
    await popupPage
      .getByRole('heading', { name: 'Popup Site' })
      .waitFor({ state: 'visible', timeout: 5000 })
      .catch(() => {});
    check(
      'карточка сайта появилась в настройках popup',
      (await popupPage.getByRole('heading', { name: 'Popup Site' }).count()) === 1,
    );
    await checkGeometry(
      check,
      'popup-настройки: геометрия с карточкой custom-сайта',
      popupPage,
    );

    // Ошибка валидации лимита: тексты ошибок остаются внутри карточки.
    const popupSiteCard = popupPage.locator('section.card', {
      has: popupPage.getByRole('heading', { name: 'Popup Site' }),
    });
    await popupSiteCard.getByLabel(/Лимит сессии, минут/).fill('-1');
    await popupPage.getByRole('button', { name: 'Сохранить' }).click();
    await popupSiteCard
      .getByText(/Лимит сессии: целое число/)
      .waitFor({ state: 'visible', timeout: 5000 })
      .catch(() => {});
    await checkGeometry(
      check,
      'popup-настройки: геометрия с ошибкой валидации лимита',
      popupPage,
    );
    await popupSiteCard.getByLabel(/Лимит сессии, минут/).fill('15');
    await popupPage.getByRole('button', { name: 'Сохранить' }).click();
    await popupPage
      .getByText('Сохранено')
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => check('сохранение custom-сайта из popup прошло', true))
      .catch(() => check('сохранение custom-сайта из popup прошло', false));
    const popupSaved = await readStoredConfig();
    check(
      'custom-сайт из popup сохранён в конфигурации',
      (popupSaved?.customSites ?? []).some(
        (s) => s.name === 'Popup Site' && s.url === `${CUSTOM_HOST}/`,
      ),
    );
    await checkGeometry(
      check,
      'popup-настройки: геометрия после сохранения (status «Сохранено»)',
      popupPage,
    );

    // «Назад» возвращает на dashboard popup.
    await popupPage.getByRole('button', { name: 'Назад' }).click();
    check(
      'возврат «Назад» показывает dashboard снова',
      await popupPage.getByText('Instagram Reels').first().isVisible(),
    );
    await popupPage.close();

    console.log('\nСценарий 6: мультитаб warning — каждая вкладка Shorts заблокирована');
    await primeAndReload(baseConfig(), primedYoutubeState());
    const multiA = await openFakePage('https://www.youtube.com/shorts/multi-a');
    await multiA.locator('#dsb-overlay-host').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    // Вторая вкладка того же сервиса открывается ПОСЛЕ исчерпания лимита —
    // без enforcement она осталась бы доступной (DEFECT-1).
    const multiB = await openFakePage('https://www.youtube.com/shorts/multi-b');
    await multiB.locator('#dsb-overlay-host').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    check('overlay на первой вкладке', (await multiA.locator('#dsb-overlay-host').count()) === 1);
    check('overlay появился и на второй (новой) вкладке', (await multiB.locator('#dsb-overlay-host').count()) === 1);
    const multiTextB = await overlayTextOf(multiB);
    check('overlay на второй вкладке содержит сообщение', multiTextB.includes(MESSAGE));
    const multiState = await readStoredState();
    check(
      'время не убегает далеко за лимит после блокировки',
      typeof multiState?.youtube?.sessionSeconds === 'number' &&
        multiState.youtube.sessionSeconds < 15 * 60 + 120,
    );
    await multiA.close().catch(() => {});
    await multiB.close().catch(() => {});

    console.log('\nСценарий 7: мультитаб close — новая вкладка Shorts тоже закрывается');
    const closeMultiConfig = baseConfig();
    closeMultiConfig.services.youtube = defaultService({ action: 'close' });
    await primeAndReload(closeMultiConfig, primedYoutubeState());
    const closeA = await openFakePage('https://www.youtube.com/shorts/close-a');
    await closeA.waitForEvent('close', { timeout: 15000 }).catch(() => {});
    check('первая вкладка закрыта автоматически', closeA.isClosed());
    const closeB = await openFakePage('https://www.youtube.com/shorts/close-b');
    await closeB.waitForEvent('close', { timeout: 15000 }).catch(() => {});
    check('вторая (новая) вкладка закрыта автоматически', closeB.isClosed());

    console.log('\nСценарий 8: redirect переводит вкладку на целевой URL');
    const redirectConfig = baseConfig();
    redirectConfig.services.youtube = defaultService({
      action: 'redirect',
      redirectUrl: 'https://example.com/back-to-work',
    });
    await primeAndReload(redirectConfig, primedYoutubeState());
    const redirectPage = await openFakePage('https://www.youtube.com/shorts/redirect-me');
    await redirectPage.waitForURL('https://example.com/back-to-work', { timeout: 15000 }).catch(() => {});
    check('вкладка перенаправлена на целевой URL', redirectPage.url() === 'https://example.com/back-to-work');
    await redirectPage.close().catch(() => {});

    console.log('\nСценарий 9: redirectUrl в отслеживаемую зону не зацикливается (защита в runtime)');
    // Конфиг пишем напрямую, минуя UI-валидацию: background обязан не зависнуть в цикле.
    const loopConfig = baseConfig();
    loopConfig.services.youtube = defaultService({ action: 'redirect', redirectUrl: 'https://www.tiktok.com/' });
    await primeAndReload(loopConfig, primedYoutubeState());
    const loopPage = await openFakePage('https://www.youtube.com/shorts/loop-guard');
    await loopPage.waitForTimeout(5000);
    check('перенаправления нет — URL остался на Shorts', loopPage.url().includes('youtube.com/shorts'));
    check('вместо цикла показан warning overlay', (await loopPage.locator('#dsb-overlay-host').count()) === 1);
    await loopPage.close().catch(() => {});

    console.log('\nСценарий 10: SPA-уход с Shorts на /watch скрывает overlay (DEFECT-2)');
    await primeAndReload(baseConfig(), primedYoutubeState());
    const spaOut = await openFakePage('https://www.youtube.com/shorts/spa-out');
    await spaOut.locator('#dsb-overlay-host').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    check('overlay показан на Shorts перед SPA-уходом', (await spaOut.locator('#dsb-overlay-host').count()) === 1);
    await spaOut.evaluate(() => history.pushState({}, '', '/watch?v=e2e'));
    await spaOut.locator('#dsb-overlay-host').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    check('overlay скрыт после SPA-ухода на /watch', (await spaOut.locator('#dsb-overlay-host').count()) === 0);
    await spaOut.close().catch(() => {});

    console.log('\nСценарий 11: SPA-вход на /shorts блокирует уже открытую вкладку');
    await primeAndReload(baseConfig(), primedYoutubeState());
    const spaIn = await openFakePage('https://www.youtube.com/watch?v=before');
    await spaIn.waitForTimeout(1500);
    check('на /watch overlay отсутствует', (await spaIn.locator('#dsb-overlay-host').count()) === 0);
    await spaIn.evaluate(() => history.pushState({}, '', '/shorts/spa-in'));
    await spaIn.locator('#dsb-overlay-host').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    check('после SPA-входа на /shorts overlay появился', (await spaIn.locator('#dsb-overlay-host').count()) === 1);
    await spaIn.close().catch(() => {});

    console.log('\nСценарий 12: увеличение лимита снимает блокировку и скрывает overlay (DEFECT-3)');
    await primeAndReload(baseConfig(), primedYoutubeState());
    const liftPage = await openFakePage('https://www.youtube.com/shorts/lift-limit');
    await liftPage.locator('#dsb-overlay-host').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    check('overlay активен перед увеличением лимита', (await liftPage.locator('#dsb-overlay-host').count()) === 1);
    // Тот же путь записи, что и у options: полный конфиг через chrome.storage.local.
    const liftedConfig = baseConfig();
    liftedConfig.services.youtube = defaultService({ sessionLimitMinutes: 30 });
    await writeConfig(liftedConfig);
    await liftPage.locator('#dsb-overlay-host').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    check('overlay исчез после увеличения лимита', (await liftPage.locator('#dsb-overlay-host').count()) === 0);
    check(
      'страница снова доступна (контент виден)',
      await liftPage.getByRole('heading', { name: 'fake video page' }).isVisible(),
    );
    await liftPage.waitForTimeout(2500);
    check('блокировка не возвращается при новом лимите', (await liftPage.locator('#dsb-overlay-host').count()) === 0);
    await liftPage.close().catch(() => {});

    console.log('\nСценарий 13: enabled=false снимает блокировку и останавливает учёт (DEFECT-4)');
    await primeAndReload(baseConfig(), primedYoutubeState());
    const disPage = await openFakePage('https://www.youtube.com/shorts/disable-me');
    await disPage.locator('#dsb-overlay-host').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    check('overlay активен перед отключением', (await disPage.locator('#dsb-overlay-host').count()) === 1);
    // Тот же путь записи, что и у переключателя в popup: saveConfig -> chrome.storage.local.
    const disabledConfig = baseConfig();
    disabledConfig.services.youtube = defaultService({ enabled: false });
    await writeConfig(disabledConfig);
    await disPage.locator('#dsb-overlay-host').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    check('overlay исчез после отключения сервиса', (await disPage.locator('#dsb-overlay-host').count()) === 0);
    check(
      'страница доступна после отключения',
      await disPage.getByRole('heading', { name: 'fake video page' }).isVisible(),
    );
    const beforeDisableRead = await readStoredState();
    // Новая отслеживаемая страница не блокируется, время не идёт.
    const disPage2 = await openFakePage('https://www.youtube.com/shorts/after-disable');
    await disPage2.waitForTimeout(3000);
    check('новая вкладка Shorts не блокируется', (await disPage2.locator('#dsb-overlay-host').count()) === 0);
    const afterDisableRead = await readStoredState();
    check(
      'blockedReason не восстанавливается по старым счётчикам',
      afterDisableRead?.youtube?.blockedReason === null,
    );
    check(
      'время не учитывается, пока сервис отключён',
      typeof beforeDisableRead?.youtube?.sessionSeconds === 'number' &&
        afterDisableRead?.youtube?.sessionSeconds === beforeDisableRead.youtube.sessionSeconds,
    );
    await disPage.close().catch(() => {});
    await disPage2.close().catch(() => {});

    console.log('\nСценарий 14: повторное включение работает по текущим счётчикам и лимитам');
    const disabledPrimeConfig = baseConfig();
    disabledPrimeConfig.services.youtube = defaultService({ enabled: false });
    await primeAndReload(disabledPrimeConfig, primedYoutubeState());
    const rePage = await openFakePage('https://www.youtube.com/shorts/re-enabled');
    await rePage.waitForTimeout(2500);
    check('пока сервис выключен — блокировки нет', (await rePage.locator('#dsb-overlay-host').count()) === 0);
    // Включаем с лимитом 30 мин: счётчик ~15 мин — блокировать нечего.
    const highConfig = baseConfig();
    highConfig.services.youtube = defaultService({ sessionLimitMinutes: 30 });
    await writeConfig(highConfig);
    await rePage.waitForTimeout(2500);
    check('после enable с лимитом 30 мин блокировки нет', (await rePage.locator('#dsb-overlay-host').count()) === 0);
    // Возвращаем лимит 15 мин: счётчики сохранились — блокировка возвращается.
    await writeConfig(baseConfig());
    await rePage.locator('#dsb-overlay-host').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    check('после возврата лимита 15 мин блокировка снова работает', (await rePage.locator('#dsb-overlay-host').count()) === 1);
    await rePage.close().catch(() => {});

    console.log('\nСценарий 15: нулевой лимит блокирует сразу, без накопления минут (warning)');
    const zeroWarningConfig = baseConfig();
    zeroWarningConfig.services.youtube = defaultService({ sessionLimitMinutes: 0 });
    // Свежие счётчики — никакого накопленного времени нет.
    await primeAndReload(zeroWarningConfig, {
      youtube: emptyService(),
      instagram: emptyService(),
      tiktok: emptyService(),
    });
    const zeroPage = await openFakePage('https://www.youtube.com/shorts/zero-warning');
    // Действие должно сработать сразу при входе — без ожидания минуты.
    await zeroPage.locator('#dsb-overlay-host').waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
    check('overlay показан немедленно при лимите 0', (await zeroPage.locator('#dsb-overlay-host').count()) === 1);
    const zeroText = await overlayTextOf(zeroPage);
    check('причина — лимит сессии 0 минут', zeroText.includes('Лимит сессии (0 мин)'));
    check('нулевая блокировка персистентна', (await waitForStoredBlockedReason('youtube')) === 'session');
    await zeroPage.close().catch(() => {});

    console.log('\nСценарий 16: нулевой лимит — close и redirect срабатывают сразу');
    const zeroCloseConfig = baseConfig();
    zeroCloseConfig.services.youtube = defaultService({ action: 'close', sessionLimitMinutes: 0 });
    await primeAndReload(zeroCloseConfig, {
      youtube: emptyService(),
      instagram: emptyService(),
      tiktok: emptyService(),
    });
    const zeroClosePage = await openFakePage('https://www.youtube.com/shorts/zero-close');
    await zeroClosePage.waitForEvent('close', { timeout: 15000 }).catch(() => {});
    check('вкладка закрыта немедленно при лимите 0 (close)', zeroClosePage.isClosed());

    const zeroRedirectConfig = baseConfig();
    zeroRedirectConfig.services.youtube = defaultService({
      action: 'redirect',
      sessionLimitMinutes: 0,
      redirectUrl: 'https://example.com/zero-redirect',
    });
    await primeAndReload(zeroRedirectConfig, {
      youtube: emptyService(),
      instagram: emptyService(),
      tiktok: emptyService(),
    });
    const zeroRedirectPage = await openFakePage('https://www.youtube.com/shorts/zero-redirect-tab');
    await zeroRedirectPage.waitForURL('https://example.com/zero-redirect', { timeout: 15000 }).catch(() => {});
    check(
      'вкладка перенаправлена немедленно при лимите 0 (redirect)',
      zeroRedirectPage.url() === 'https://example.com/zero-redirect',
    );
    await zeroRedirectPage.close().catch(() => {});

    console.log('\nСценарий 17: область «Весь YouTube» блокирует /watch; смена области работает без переустановки');
    const allYoutubeConfig = baseConfig();
    allYoutubeConfig.youtubeScope = 'all';
    await primeAndReload(allYoutubeConfig, primedYoutubeState());
    const watchBlocked = await openFakePage('https://www.youtube.com/watch?v=full-yt');
    await watchBlocked.locator('#dsb-overlay-host').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    check('overlay на обычном видео при области «весь YouTube»', (await watchBlocked.locator('#dsb-overlay-host').count()) === 1);
    const watchText = await overlayTextOf(watchBlocked);
    check('overlay подписан как весь YouTube', watchText.includes('YouTube'));
    // Смена области «на лету»: та же вкладка /watch перестаёт отслеживаться.
    await writeConfig(baseConfig());
    await watchBlocked.locator('#dsb-overlay-host').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    check('overlay скрыт после смены области на «только Shorts»', (await watchBlocked.locator('#dsb-overlay-host').count()) === 0);
    check(
      'страница /watch снова доступна',
      await watchBlocked.getByRole('heading', { name: 'fake video page' }).isVisible(),
    );
    // И обратно: shorts-зона продолжает блокировать.
    await watchBlocked.evaluate(() => history.pushState({}, '', '/shorts/full-yt'));
    await watchBlocked.locator('#dsb-overlay-host').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    check('SPA-вход на /shorts снова блокирует ту же вкладку', (await watchBlocked.locator('#dsb-overlay-host').count()) === 1);
    await watchBlocked.close().catch(() => {});

    console.log('\nСценарий 18: custom-сайт через UI options — add, permission path, warning с лимитом 0');
    // Конфиг чистый: добавляем сайт только через интерфейс options (без JSON).
    await primeAndReload(baseConfig(), {
      youtube: emptyService(),
      instagram: emptyService(),
      tiktok: emptyService(),
    });
    const customOptions = await context.newPage();
    await customOptions.goto(`chrome-extension://${extensionId}/options.html`);
    await customOptions.getByLabel('Название нового сайта').fill('E2E Custom');
    await customOptions.getByLabel('Адрес нового сайта (URL)').fill(CUSTOM_HOST);
    await customOptions.getByRole('button', { name: 'Добавить сайт' }).click();
    const customCard = customOptions.locator('section.card', {
      has: customOptions.getByRole('heading', { name: 'E2E Custom' }),
    });
    await customCard.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    check('карточка сайта появилась в options', (await customCard.count()) === 1);
    // Лимит 0 — блокировать сразу.
    await customCard.getByLabel(/Лимит сессии, минут/).fill('0');
    await customOptions.getByRole('button', { name: 'Сохранить' }).click();
    await customOptions
      .getByText('Сохранено')
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => check('сохранение custom-сайта прошло', true))
      .catch(() => check('сохранение custom-сайта прошло', false));

    const savedConfig = await readStoredConfig();
    const savedSite = savedConfig?.customSites?.[0];
    check('сайт сохранён в конфигурации', savedSite?.name === 'E2E Custom' && savedSite?.url === `${CUSTOM_HOST}/`);
    check('у сайта независимые лимиты (0 минут)', savedSite?.sessionLimitMinutes === 0);

    // Регистрация content script для custom-домена (динамическая, через scripting API).
    await new Promise((r) => setTimeout(r, 1500));
    const scriptIds = await readCustomScripts();
    check(
      'content script зарегистрирован для custom-домена',
      scriptIds.some((id) => id.startsWith('dsb-custom-')),
    );

    // Открываем страницу домена — overlay немедленно (лимит 0).
    const customPage = await openFakePage(`${CUSTOM_HOST}/`);
    await customPage.locator('#dsb-overlay-host').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    check('overlay на custom-домене', (await customPage.locator('#dsb-overlay-host').count()) === 1);
    const customText = await overlayTextOf(customPage);
    check('overlay custom-сайта подписан его именем', customText.includes('E2E Custom'));
    check('причина — лимит 0 минут', customText.includes('Лимит сессии (0 мин)'));
    check(
      'блокировка custom-сайта персистентна и независима от YouTube',
      (await waitForStoredBlockedReason(savedSite.id)) === 'session',
    );
    const customState = await readStoredState();
    check(
      'у custom-сайта свой счётчик (сессия растёт с нуля)',
      typeof customState?.[savedSite.id]?.sessionSeconds === 'number' &&
        customState[savedSite.id].sessionSeconds < 120,
    );
    check(
      'счётчики YouTube не тронуты custom-сайтом',
      typeof customState?.youtube?.sessionSeconds === 'number' && customState.youtube.sessionSeconds < 120,
    );

    // Редактирование адреса сайта: reconcile должен пересоздать регистрацию
    // на новых matches, а не оставить старый паттерн.
    await customCard.getByLabel('Адрес сайта (URL)').fill(`${CUSTOM_HOST}/feed`);
    await customOptions.getByRole('button', { name: 'Сохранить' }).click();
    await customOptions
      .getByText('Сохранено')
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => check('сохранение после смены адреса сайта', true))
      .catch(() => check('сохранение после смены адреса сайта', false));
    await new Promise((r) => setTimeout(r, 2000));
    const registrations = await readCustomRegistrations();
    const expectedMatches = [`https://*.doomscroll-e2e.test/feed`, 'https://*.doomscroll-e2e.test/feed/*'];
    check(
      'после edit URL регистрация обновлена на новые matches',
      registrations.length === 1 &&
        JSON.stringify([...(registrations[0]?.matches ?? [])].sort()) ===
          JSON.stringify([...expectedMatches].sort()),
    );
    check(
      'старые matches (корень домена) не остались в регистрации',
      !registrations.some((script) => script.matches.includes('https://*.doomscroll-e2e.test/*')),
    );

    console.log('\nСценарий 19: удаление custom-сайта снимает блокировку и отменяет регистрацию');
    customOptions.on('dialog', (dialog) => void dialog.accept());
    await customCard.getByRole('button', { name: 'Удалить сайт' }).click();
    check('подтверждение удаления показано (dialog)', true);
    await customOptions.getByRole('button', { name: 'Сохранить' }).click();
    await customOptions
      .getByText('Сохранено')
      .waitFor({ state: 'visible', timeout: 5000 })
      .catch(() => check('сохранение после удаления', false));
    // Блокировка на открытой вкладке снимается.
    await customPage.locator('#dsb-overlay-host').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    check('overlay на открытой вкладке скрыт после удаления сайта', (await customPage.locator('#dsb-overlay-host').count()) === 0);
    check(
      'страница custom-домена снова доступна',
      await customPage.getByRole('heading', { name: 'fake video page' }).isVisible(),
    );
    await new Promise((r) => setTimeout(r, 1500));
    const scriptsAfterRemove = await readCustomScripts();
    check(
      'регистрация content script отменена',
      !scriptsAfterRemove.some((id) => id.startsWith('dsb-custom-')),
    );
    const stateAfterRemove = await readStoredState();
    check('usage удалённого сайта вычищена из состояния', !(savedSite.id in (stateAfterRemove ?? {})));
    await customPage.close().catch(() => {});
    await customOptions.close().catch(() => {});

    console.log('\nСценарий 20: custom-сайт — действие close с нулевым лимитом (запись конфигом, как у options)');
    const closeSiteConfig = baseConfig();
    closeSiteConfig.customSites.push(
      customSite('site-close', 'E2E Close', CUSTOM_HOST, { action: 'close', sessionLimitMinutes: 0 }),
    );
    await primeAndReload(closeSiteConfig, {
      youtube: emptyService(),
      instagram: emptyService(),
      tiktok: emptyService(),
    });
    const closeSitePage = await openFakePage(`${CUSTOM_HOST}/close-me`);
    await closeSitePage.waitForEvent('close', { timeout: 15000 }).catch(() => {});
    check('вкладка custom-сайта закрыта автоматически (close, лимит 0)', closeSitePage.isClosed());

    console.log('\nСценарий 21: DEFECT-5 — свежий config инвалидирует прерванный черновик');
    // Последовательность из дефекта: прерванный permission-save оставляет
    // pending → toggle на dashboard (прямой saveConfig) → повторное открытие
    // настроек не должно применить устаревший черновик.
    await primeAndReload(baseConfig(), {
      youtube: emptyService(),
      instagram: emptyService(),
      tiktok: emptyService(),
    });
    const staleDraft = baseConfig();
    staleDraft.services.youtube.sessionLimitMinutes = 33;
    staleDraft.customSites.push(customSite('site-stale', 'Stale Draft', CUSTOM_HOST));
    await worker.evaluate(
      ([key, value]) => chrome.storage.local.set({ [key]: value }).then(() => true),
      [PENDING_CONFIG_KEY, staleDraft],
    );
    const readPending = () =>
      worker
        .evaluate(([key]) => chrome.storage.local.get(key).then((d) => d[key] ?? null), [
          PENDING_CONFIG_KEY,
        ])
        .catch(() => null);

    const popup21 = await context.newPage();
    await popup21.setViewportSize({ width: 400, height: 600 });
    await popup21.goto(`chrome-extension://${extensionId}/popup.html`);
    check('черновик лежит в хранилище до toggle', (await readPending()) !== null);

    // Toggle на dashboard — прямой saveConfig через UI popup.
    // (input переключателя визуально скрыт — кликаем по label.switch.)
    await popup21
      .locator('.service', { hasText: 'YouTube Shorts' })
      .locator('label.switch')
      .click();
    await worker
      .evaluate(() =>
        chrome.storage.local.get('dsb:config').then((d) => d['dsb:config']?.services?.youtube?.enabled),
      )
      .then((enabled) => check('toggle сохранил youtube.enabled=false', enabled === false));
    let pendingAfterToggle = await readPending();
    const deadline21 = Date.now() + 5000;
    while (pendingAfterToggle !== null && Date.now() < deadline21) {
      await new Promise((r) => setTimeout(r, 300));
      pendingAfterToggle = await readPending();
    }
    check('свежий config инвалидировал черновик', pendingAfterToggle === null);

    // Повторное открытие настроек: auto-resume НЕ применяет черновик.
    await popup21.getByRole('button', { name: 'Настройки' }).click();
    await popup21.getByRole('heading', { name: 'Настройки' }).waitFor({ state: 'visible', timeout: 5000 });
    await popup21.getByLabel('Название нового сайта').waitFor({ state: 'visible', timeout: 5000 });
    check(
      'auto-resume не сработал (нет автосохранения черновика)',
      (await popup21.getByText('Сохранено').count()) === 0,
    );
    check(
      'лимит сессии YouTube = 15 (не 33 из черновика)',
      (await popup21.getByLabel(/Лимит сессии, минут/).first().inputValue()) === '15',
    );
    check(
      'сайт из черновика не появился',
      (await popup21.getByRole('heading', { name: 'Stale Draft' }).count()) === 0,
    );
    const configAfter21 = await readStoredConfig();
    check(
      'stored config цел: toggle сохранён, черновик не применён',
      configAfter21?.services?.youtube?.enabled === false &&
        configAfter21?.services?.youtube?.sessionLimitMinutes === 15 &&
        (configAfter21?.customSites ?? []).length === 0,
    );
    await popup21.close();

    console.log('\nСценарий 22: нормальный resume после native prompt (доступ предвыдан)');
    // Тот же pending, но config между записью черновика и открытием настроек
    // НЕ менялся — auto-resume обязан достроить сохранение.
    await primeAndReload(baseConfig(), {
      youtube: emptyService(),
      instagram: emptyService(),
      tiktok: emptyService(),
    });
    const resumableDraft = baseConfig();
    resumableDraft.services.youtube.sessionLimitMinutes = 33;
    resumableDraft.customSites.push(customSite('site-resume', 'Resumed Site', CUSTOM_HOST));
    await worker.evaluate(
      ([key, value]) => chrome.storage.local.set({ [key]: value }).then(() => true),
      [PENDING_CONFIG_KEY, resumableDraft],
    );

    const popup22 = await context.newPage();
    await popup22.setViewportSize({ width: 400, height: 600 });
    await popup22.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup22.getByRole('button', { name: 'Настройки' }).click();
    await popup22
      .getByText('Сохранено')
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => check('auto-resume достроил сохранение (Сохранено)', true))
      .catch(() => check('auto-resume достроил сохранение (Сохранено)', false));
    check(
      'лимит сессии YouTube = 33 из черновика',
      (await popup22.getByLabel(/Лимит сессии, минут/).first().inputValue()) === '33',
    );
    check(
      'сайт из черновика в форме',
      (await popup22.getByRole('heading', { name: 'Resumed Site' }).count()) === 1,
    );
    const configAfter22 = await readStoredConfig();
    check(
      'черновик сохранён в config, pending очищен',
      configAfter22?.services?.youtube?.sessionLimitMinutes === 33 &&
        (configAfter22?.customSites ?? []).some((s) => s.name === 'Resumed Site') &&
        (await readPending()) === null,
    );
    await popup22.close();

    console.log('\nСценарий 23: options fallback — геометрия (radio scope, карточки, формы, ошибки, узкое окно)');
    // Чистый конфиг: полная страница options как fallback через chrome://extensions.
    await primeAndReload(baseConfig(), {
      youtube: emptyService(),
      instagram: emptyService(),
      tiktok: emptyService(),
    });
    const geoOptions = await context.newPage();
    await geoOptions.goto(`chrome-extension://${extensionId}/options.html`);
    await geoOptions.getByLabel('Название нового сайта').waitFor({ state: 'visible', timeout: 5000 });
    await checkGeometry(
      check,
      'options: геометрия по умолчанию (мультиколоночная сетка, radio scope YouTube)',
      geoOptions,
    );

    // Длинные название/URL/сообщение в add-form.
    const geoLongName = `Очень длинное название сайта ${'для проверки переноса '.repeat(6)}`.trim();
    const geoLongUrl = `https://doomscroll-e2e.test/${'a'.repeat(200)}`;
    const geoAddForm = geoOptions.locator('.add-site');
    await geoOptions.getByLabel('Название нового сайта').fill(geoLongName);
    await geoOptions.getByLabel('Адрес нового сайта (URL)').fill(geoLongUrl);
    await geoAddForm.getByLabel('Сообщение').fill('Д'.repeat(400));
    await checkGeometry(
      check,
      'options: геометрия с длинными названием/URL/сообщением в add-form',
      geoOptions,
    );

    // Карточка custom-сайта с длинным названием (заголовок переносится внутри карточки).
    await geoOptions.getByLabel('Адрес нового сайта (URL)').fill(CUSTOM_HOST);
    await geoOptions.getByRole('button', { name: 'Добавить сайт' }).click();
    await geoOptions
      .getByRole('heading', { name: geoLongName })
      .waitFor({ state: 'visible', timeout: 5000 })
      .catch(() => {});
    check(
      'карточка с длинным названием появилась в options',
      (await geoOptions.getByRole('heading', { name: geoLongName }).count()) === 1,
    );
    await checkGeometry(
      check,
      'options: геометрия с карточкой custom-сайта (длинное название)',
      geoOptions,
    );

    // Ошибка валидации: текст ошибки остаётся внутри карточки.
    const geoSiteCard = geoOptions.locator('section.card', {
      has: geoOptions.getByRole('heading', { name: geoLongName }),
    });
    await geoSiteCard.getByLabel(/Лимит сессии, минут/).fill('-1');
    await geoOptions.getByRole('button', { name: 'Сохранить' }).click();
    await geoSiteCard
      .getByText(/Лимит сессии: целое число/)
      .waitFor({ state: 'visible', timeout: 5000 })
      .catch(() => {});
    await checkGeometry(check, 'options: геометрия с ошибкой валидации лимита', geoOptions);

    // Узкое окно: сетка схлопывается в одну колонку, инвариант тот же.
    await geoOptions.setViewportSize({ width: 360, height: 600 });
    await checkGeometry(check, 'options: геометрия в узком окне 360px (одна колонка)', geoOptions);
    await geoOptions.close();
  } finally {
    await context.close().catch(() => {});
  }

  console.log(`\nE2E: ${passed} прошло, ${failed} провалено`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('E2E упал с ошибкой:', error);
  process.exit(1);
});
