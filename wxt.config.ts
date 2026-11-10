import { defineConfig } from 'wxt';

// WXT загружает конфиг в Node-окружении; локальная декларация вместо
// полного @types/node (нужен только process.env).
declare const process: { env: Record<string, string | undefined> };

// E2E может добавить тестовые origins в host_permissions (заранее выданное
// разрешение, чтобы нативный prompt Chrome не блокировал сценарии custom-сайтов)
// и собирать в отдельную папку, чтобы ручная установка не получала тестовые права.
const e2eOrigins = (process.env.DSB_E2E_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const isE2EBuild = e2eOrigins.length > 0;

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // WXT добавляет к outDir имя таргета (chrome-mv3) самостоятельно.
  outDir: isE2EBuild ? '.e2e-output' : undefined,
  manifest: {
    name: 'Doomscroll Blocker',
    description:
      'Лимиты времени для YouTube, Instagram Reels, TikTok и собственных сайтов: предупреждение, перенаправление или закрытие вкладки.',
    permissions: ['storage', 'alarms', 'scripting'],
    // Постоянный доступ — только к встроенным сервисам. Для custom-сайтов
    // используются optional_host_permissions: доступ запрашивается один раз
    // при добавлении сайта (chrome.permissions.request из клика «Сохранить»).
    host_permissions: [
      '*://www.youtube.com/*',
      '*://m.youtube.com/*',
      '*://www.instagram.com/*',
      '*://instagram.com/*',
      '*://www.tiktok.com/*',
      '*://tiktok.com/*',
      ...e2eOrigins,
    ],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
  },
});
