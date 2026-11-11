import { defineBackground } from 'wxt/utils/define-background';
import {
  getDefaultConfig,
  type ExtensionConfig,
  type ServiceConfig,
} from '../core/config';
import {
  emptyServiceState,
  getExceeded,
  reasonLabel,
  tickServiceState,
  type LimitReason,
  type ServiceState,
} from '../core/limits';
import { isCloseTabMessage, isTabStateMessage, type OverlayMessage } from '../core/messages';
import { classifyUrl } from '../core/matching';
import { builtinLabel, isServiceId } from '../core/services';
import { CONFIG_KEY, clearPendingConfig, loadConfig, loadState, saveState, type StoredState } from '../adapters/storage';
import { tryResumePendingConfig } from '../adapters/pendingResume';
import {
  CONTENT_SCRIPT_FILE,
  injectContentScriptIntoTabsMatching,
  syncCustomContentScripts,
} from '../adapters/scripting';

const WATCHDOG_ALARM = 'dsb-watchdog';
/** Один тик учитывает не больше минуты, чтобы после сна/перезапуска SW не было скачка. */
const MAX_DELTA_SECONDS = 60;
/** Состояние сбрасываем в хранилище не чаще, чем раз в 5 секунд. */
const SAVE_INTERVAL_MS = 5000;

interface TabInfo {
  /** Отслеживаемая цель вкладки: ServiceId встроенного сервиса или id custom-сайта; null — не отслеживается. */
  target: string | null;
  /** Последний известный URL вкладки (для переклассификации при смене конфигурации). */
  url: string | undefined;
  active: boolean;
  windowId: number;
  hidden: boolean;
  docFocused: boolean;
  /** Warning overlay сейчас показан на этой вкладке. */
  overlayShown: boolean;
  /** Действие (close/redirect) уже применено к вкладке для текущей блокировки. */
  actionTaken: boolean;
}

function newTabInfo(windowId = -1): TabInfo {
  return {
    target: null,
    url: undefined,
    active: false,
    windowId,
    hidden: false,
    docFocused: true,
    overlayShown: false,
    actionTaken: false,
  };
}

export default defineBackground(() => {
  const tabs = new Map<number, TabInfo>();
  let config: ExtensionConfig = getDefaultConfig();
  let tracking: StoredState = {};
  let focusedWindowIds = new Set<number>();
  let lastTickAtMs = Date.now();
  let carryMs = 0;
  let lastSaveAtMs = 0;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let initStarted = false;

  function tabInfo(tabId: number): TabInfo {
    return tabs.get(tabId) ?? newTabInfo();
  }

  /** Все отслеживаемые цели: встроенные сервисы + пользовательские сайты. */
  function allTargetIds(): string[] {
    return [...config.customSites.map((site) => site.id), ...Object.keys(config.services)];
  }

  function configForTarget(target: string): ServiceConfig | null {
    if (isServiceId(target)) return config.services[target];
    return config.customSites.find((site) => site.id === target) ?? null;
  }

  function labelForTarget(target: string): string {
    if (isServiceId(target)) return builtinLabel(target, config.youtubeScope);
    return config.customSites.find((site) => site.id === target)?.name ?? 'Сайт';
  }

  /** Состояние цели; лениво создаётся для только что добавленных сайтов. */
  function stateFor(target: string): ServiceState {
    const existing = tracking[target];
    if (existing) return existing;
    const created = emptyServiceState(Date.now());
    tracking[target] = created;
    return created;
  }

  function isCountable(info: TabInfo): boolean {
    if (info.target === null) return false;
    return (
      info.active &&
      focusedWindowIds.has(info.windowId) &&
      !info.hidden &&
      info.docFocused &&
      (configForTarget(info.target)?.enabled ?? false)
    );
  }

  async function refreshFocusedWindows(): Promise<void> {
    try {
      const windows = await chrome.windows.getAll();
      focusedWindowIds = new Set(windows.filter((w) => w.focused).map((w) => w.id ?? -1));
    } catch {
      // Оставляем предыдущее значение; на следующем тике повторим.
    }
  }

  /** Скрыть overlay на вкладке (best-effort, ответ не нужен). */
  function hideOverlay(tabId: number): void {
    chrome.tabs
      .sendMessage(tabId, { type: 'dsb:overlay', show: false })
      .catch(() => {
        // Content script ещё не подключён или вкладка закрылась — скрывать нечего.
      });
  }

  /**
   * Доставить overlay во вкладку: sendMessage, при неудаче — запасная инъекция
   * content script (вкладка открыта до установки/регистрации). Возвращает
   * Promise с фактом доставки, чтобы не списывать действие как выполненное
   * при транзиентной ошибке — тик повторит показ.
   */
  function deliverOverlay(tabId: number, payload: OverlayMessage): Promise<boolean> {
    return chrome.tabs
      .sendMessage(tabId, payload)
      .then(() => true)
      .catch(() =>
        chrome.scripting
          .executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] })
          .then(() => chrome.tabs.sendMessage(tabId, payload))
          .then(() => true)
          .catch(() => false),
      );
  }

  function showPayload(target: string, reason: LimitReason): OverlayMessage {
    const targetConfig = configForTarget(target);
    return {
      type: 'dsb:overlay',
      show: true,
      targetId: target,
      serviceLabel: labelForTarget(target),
      reason,
      reasonText: targetConfig ? reasonLabel(reason, targetConfig) : 'Лимит времени исчерпан',
      message: targetConfig?.message ?? '',
      redirectUrl: targetConfig?.redirectUrl || null,
    };
  }

  /**
   * Снять блокировку с конкретной вкладки: скрыть overlay и разрешить
   * повторное применение действия при следующей блокировке.
   */
  function clearTabBlock(tabId: number, info: TabInfo): void {
    hideOverlay(tabId);
    info.overlayShown = false;
    info.actionTaken = false;
  }

  /**
   * Применить действие блокировки к одной вкладке. Идемпотентно:
   * warning не дублируется, close/redirect не повторяются для уже
   * обработанной вкладки, но каждая новая вкладка цели обрабатывается.
   */
  function applyBlockAction(
    target: string,
    reason: LimitReason,
    tabId: number,
    info: TabInfo,
  ): void {
    // Отключённая цель никогда не блокируется, даже если blockedReason
    // ещё не успел очиститься тиком.
    const targetConfig = configForTarget(target);
    if (!targetConfig || !targetConfig.enabled) return;

    if (targetConfig.action === 'close') {
      if (!info.actionTaken) {
        info.actionTaken = true;
        chrome.tabs.remove(tabId).catch(() => {});
      }
      return;
    }

    if (targetConfig.action === 'redirect') {
      if (classifyUrl(targetConfig.redirectUrl, config) !== null) {
        // URL ведёт обратно в отслеживаемую зону — перенаправление не дало бы
        // выйти (цикл). Безопасный fallback: показать warning. Валидация в
        // options отсекает такой URL заранее, это страховка для сторонних записей.
        if (!info.overlayShown && !info.actionTaken) {
          void deliverOverlay(tabId, showPayload(target, reason)).then((delivered) => {
            // Считаем действие выполненным только после фактической доставки:
            // при транзиентной ошибке тик повторит показ.
            info.overlayShown = delivered;
            info.actionTaken = delivered;
          });
        }
      } else {
        if (info.actionTaken) return;
        info.actionTaken = true;
        chrome.tabs.update(tabId, { url: targetConfig.redirectUrl }).catch(() => {});
      }
      return;
    }

    // warning: полноэкранный overlay через content script (без дубликатов).
    if (!info.overlayShown) {
      void deliverOverlay(tabId, showPayload(target, reason)).then((delivered) => {
        info.overlayShown = delivered;
      });
    }
  }

  /**
   * Актуальная причина блокировки цели. blockedReason обновляется тиком,
   * но при нулевых лимитах (0 — блокировать сразу) тик ждать нельзя:
   * превышение вычисляется по текущим счётчикам на месте.
   */
  function currentReasonFor(target: string): LimitReason | null {
    const targetConfig = configForTarget(target);
    if (!targetConfig || !targetConfig.enabled) return null;
    const state = tracking[target];
    return state?.blockedReason ?? getExceeded(state ?? emptyServiceState(Date.now()), targetConfig);
  }

  /** Заблокировать вкладку, если её цель сейчас в блокировке. */
  function enforceServiceTab(tabId: number): void {
    const info = tabs.get(tabId);
    if (!info || info.target === null) return;
    const reason = currentReasonFor(info.target);
    if (reason !== null) applyBlockAction(info.target, reason, tabId, info);
  }

  /**
   * Переклассифицировать вкладку по URL. Смена цели (в том числе SPA-уход
   * на неотслеживаемую страницу) снимает блокировку вкладки со старой цели,
   * включая скрытие overlay; вход в заблокированную цель блокирует сразу.
   */
  function reclassifyTab(tabId: number, url: string | undefined): void {
    if (!url) return;
    const info = tabInfo(tabId);
    info.url = url;
    const next = classifyUrl(url, config);
    const nextTarget = next?.id ?? null;
    if (nextTarget !== null) stateFor(nextTarget);
    if (nextTarget === info.target) {
      tabs.set(tabId, info);
      enforceServiceTab(tabId);
      return;
    }
    clearTabBlock(tabId, info);
    info.target = nextTarget;
    tabs.set(tabId, info);
    enforceServiceTab(tabId);
  }

  async function tick(): Promise<void> {
    const now = Date.now();
    carryMs += now - lastTickAtMs;
    lastTickAtMs = now;
    const deltaSeconds = Math.min(MAX_DELTA_SECONDS, Math.floor(carryMs / 1000));
    carryMs -= deltaSeconds * 1000;

    await refreshFocusedWindows();
    // Периодический «пинг» API удерживает service worker живым в MV3.
    try {
      chrome.runtime.getPlatformInfo().catch(() => {});
    } catch {
      // API временно недоступен — не мешаем тиканью.
    }

    // Тик идёт даже с нулевой дельтой: при лимите 0 превышение должно
    // зафиксироваться без ожидания накопленной активности.
    const anyOpen = new Map<string, boolean>();
    const countable = new Map<string, number[]>();

    for (const [tabId, info] of tabs) {
      if (info.target === null) continue;
      anyOpen.set(info.target, true);
      if (isCountable(info)) {
        const list = countable.get(info.target);
        if (list) list.push(tabId);
        else countable.set(info.target, [tabId]);
      }
    }

    let changed = false;
    for (const target of allTargetIds()) {
      const targetConfig = configForTarget(target);
      if (!targetConfig) continue;
      const previous = stateFor(target);
      const result = tickServiceState(
        previous,
        targetConfig,
        {
          activeSeconds: (countable.get(target)?.length ?? 0) > 0 ? deltaSeconds : 0,
          anyTabOpen: anyOpen.get(target) ?? false,
        },
        now,
      );
      tracking[target] = result.state;
      if (result.state !== previous) changed = true;

      // Пока блокировка цели активна — держим под блокировкой каждую её
      // вкладку (при появлении, активации, навигации, новых вкладках).
      // При переходе в unblocked overlay скрывается гарантированно и
      // независимо от per-tab флагов (wasBlocked), чтобы сброс флагов
      // в обработчике конфигурации не мог оставить висячий overlay.
      const wasBlocked = previous.blockedReason !== null;
      for (const [tabId, info] of tabs) {
        if (info.target !== target) continue;
        if (result.state.blockedReason !== null) {
          applyBlockAction(target, result.state.blockedReason, tabId, info);
        } else if (wasBlocked || info.overlayShown || info.actionTaken) {
          clearTabBlock(tabId, info);
        }
      }
    }

    if (changed && now - lastSaveAtMs >= SAVE_INTERVAL_MS) {
      lastSaveAtMs = now;
      await saveState(tracking);
    }
  }

  function startTicking(): void {
    if (tickTimer !== null) return;
    lastTickAtMs = Date.now();
    carryMs = 0;
    tickTimer = setInterval(() => {
      void tick();
    }, 1000);
  }

  /** Реакция на смену конфигурации: новые/удалённые сайты, область YouTube, лимиты. */
  async function handleConfigChange(nextConfig: ExtensionConfig): Promise<void> {
    const prevConfig = config;
    config = nextConfig;

    // Удалённые custom-сайты: вычистить usage и снять блокировку с их вкладок.
    const removedSites = prevConfig.customSites.filter(
      (site) => !config.customSites.some((next) => next.id === site.id),
    );
    for (const site of removedSites) {
      delete tracking[site.id];
      for (const [tabId, info] of tabs) {
        if (info.target !== site.id) continue;
        clearTabBlock(tabId, info);
        info.target = null;
      }
    }

    // Состояние для новых целей (добавленные сайты) создаём заранее.
    for (const target of allTargetIds()) stateFor(target);

    for (const target of allTargetIds()) {
      const targetConfig = configForTarget(target);
      if (!targetConfig || targetConfig.enabled) continue;
      // Отключение снимает блокировку: счётчики сохраняются, но время
      // не учитывается, enforcement невозможен, overlay скрывается
      // немедленно, не дожидаясь следующего тика.
      stateFor(target).blockedReason = null;
      for (const [tabId, info] of tabs) {
        if (info.target !== target) continue;
        if (info.overlayShown || info.actionTaken) clearTabBlock(tabId, info);
      }
    }

    // Область YouTube и список сайтов могли изменить классификацию —
    // переклассифицируем все вкладки с известным URL. Для включённых целей
    // сбрасываем per-tab флаги, чтобы действие применилось заново и overlay
    // обновил текст при изменении настроек.
    for (const [tabId, info] of tabs) {
      if (!info.url) continue;
      const targetConfig = info.target !== null ? configForTarget(info.target) : null;
      if (targetConfig?.enabled) {
        info.overlayShown = false;
        info.actionTaken = false;
      }
      reclassifyTab(tabId, info.url);
    }

    const addedSites = config.customSites.filter(
      (site) => !prevConfig.customSites.some((prev) => prev.id === site.id),
    );
    await syncCustomContentScripts(config.customSites).catch(() => false);
    if (addedSites.length > 0) {
      // Уже открытые вкладки нового сайта не получат скрипт автоматически
      // (регистрация действует на загрузки) — досылаем вручную.
      await injectContentScriptIntoTabsMatching(addedSites).catch(() => false);
    }

    await saveState(tracking);
  }

  async function init(): Promise<void> {
    if (initStarted) return;
    initStarted = true;

    config = await loadConfig();
    tracking = await loadState(new Date(), [
      ...Object.keys(config.services),
      ...config.customSites.map((site) => site.id),
    ]);

    const [allTabs, allWindows] = await Promise.all([
      chrome.tabs.query({}),
      chrome.windows.getAll(),
    ]);
    focusedWindowIds = new Set(allWindows.filter((w) => w.focused).map((w) => w.id ?? -1));
    for (const tab of allTabs) {
      const info = {
        ...newTabInfo(tab.windowId ?? -1),
        url: tab.url,
        target: tab.url ? (classifyUrl(tab.url, config)?.id ?? null) : null,
        active: tab.active,
      };
      if (info.target !== null) stateFor(info.target);
      tabs.set(tab.id ?? -1, info);
    }

    // Восстановление динамических регистраций после перезапуска браузера/SW:
    // сверяемся с конфигурацией и досылаем скрипт в уже открытые вкладки.
    await syncCustomContentScripts(config.customSites).catch(() => false);
    await injectContentScriptIntoTabsMatching(config.customSites).catch(() => false);
    for (const [tabId, info] of tabs) {
      if (info.target !== null) enforceServiceTab(tabId);
    }

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      const info = tabInfo(tabId);
      if (changeInfo.status === 'loading') {
        info.hidden = false;
        info.docFocused = true;
      }
      if (changeInfo.url !== undefined) {
        info.url = changeInfo.url;
      } else if (tab.url) {
        info.url = tab.url;
      }
      tabs.set(tabId, info);
      if (changeInfo.url !== undefined) {
        reclassifyTab(tabId, changeInfo.url);
      } else if (changeInfo.status === 'loading' && tab.url) {
        reclassifyTab(tabId, tab.url);
      }
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      tabs.delete(tabId);
    });

    chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
      for (const [id, info] of tabs) {
        if (id !== tabId && info.windowId === windowId && info.active) {
          info.active = false;
        }
      }
      const info = tabInfo(tabId);
      info.active = true;
      info.windowId = windowId;
      tabs.set(tabId, info);
      // Вкладка могла сменить URL с момента последнего события — уточняем.
      chrome.tabs
        .get(tabId)
        .then((tab) => reclassifyTab(tabId, tab.url))
        .catch(() => enforceServiceTab(tabId));
    });

    chrome.windows.onFocusChanged.addListener(() => {
      void refreshFocusedWindows();
    });

    chrome.runtime.onMessage.addListener((message, sender) => {
      if (isTabStateMessage(message) && sender.tab?.id !== undefined) {
        const info = tabInfo(sender.tab.id);
        info.hidden = message.hidden;
        info.docFocused = message.hasFocus;
        tabs.set(sender.tab.id, info);
        // sender.tab.url актуален и при SPA-навигации — переклассифицируем.
        reclassifyTab(sender.tab.id, sender.tab.url);
        // Heartbeat от content script — дополнительный «тик»: будит service worker,
        // если браузер его приостановил, и подтягивает накопленное время.
        void tick();
        return undefined;
      }
      if (isCloseTabMessage(message) && sender.tab?.id !== undefined) {
        chrome.tabs.remove(sender.tab.id).catch(() => {});
      }
      return undefined;
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[CONFIG_KEY]) return;
      // Конфигурация изменилась (в т.ч. записью вне адаптера): черновик
      // прерванного сохранения построен от устаревшего состояния —
      // инвалидируем, чтобы auto-resume не перезаписал свежий config.
      void clearPendingConfig();
      void loadConfig().then((loaded) => handleConfigChange(loaded));
    });

    // Сохранение, прерванное нативным prompt разрешений: popup закрывается
    // на время показа запроса доступа, поэтому настройки сохранялись
    // черновиком (dsb:pendingConfig). Когда доступ выдан — достраиваем
    // сохранение без повторного клика; при отказе черновик ждёт в хранилище
    // и настройки восстановят его при открытии. tryResumePendingConfig
    // перечитывает черновик перед записью, поэтому параллельное сохранение
    // config (которое инвалидирует черновик) не будет им перезаписано.
    chrome.permissions.onAdded.addListener((added) => {
      if (!added.origins?.length) return;
      void tryResumePendingConfig().catch(() => false);
    });

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name !== WATCHDOG_ALARM) return;
      startTicking();
      void saveState(tracking);
    });

    chrome.runtime.onSuspend.addListener(() => {
      void saveState(tracking);
    });

    startTicking();
    void chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
  }

  void init();
});
