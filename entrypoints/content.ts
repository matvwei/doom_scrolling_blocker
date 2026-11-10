import { defineContentScript } from 'wxt/utils/define-content-script';
import type { OverlayMessage } from '../core/messages';

const HOST_ID = 'dsb-overlay-host';

const OVERLAY_STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .dsb-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(12, 12, 16, 0.94);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #f5f5f7;
  }
  .dsb-card {
    max-width: 520px;
    width: calc(100% - 48px);
    padding: 40px 36px;
    border-radius: 16px;
    background: #1d1d24;
    border: 1px solid #34343f;
    text-align: center;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  }
  .dsb-service {
    font-size: 14px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #8b8b98;
    margin-bottom: 12px;
  }
  .dsb-reason {
    font-size: 22px;
    font-weight: 700;
    margin-bottom: 16px;
  }
  .dsb-message {
    font-size: 17px;
    line-height: 1.5;
    color: #d6d6de;
    margin-bottom: 28px;
    white-space: pre-wrap;
  }
  .dsb-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .dsb-button {
    font-size: 15px;
    font-weight: 600;
    padding: 12px 24px;
    border-radius: 10px;
    border: none;
    cursor: pointer;
    transition: filter 0.15s ease;
  }
  .dsb-button:hover { filter: brightness(1.12); }
  .dsb-button--close { background: #e5484d; color: #fff; }
  .dsb-button--go { background: #2e6be6; color: #fff; }
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sendTabState(): void {
  try {
    void chrome.runtime.sendMessage({
      type: 'dsb:tab-state',
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
    });
  } catch {
    // Service worker перезапускается — heartbeat повторит отправку.
  }
}

function overlayHtml(payload: OverlayMessage): string {
  const serviceLabel = escapeHtml(payload.serviceLabel ?? 'Сайт');
  const reasonText = escapeHtml(payload.reasonText ?? 'Лимит времени исчерпан');
  const message = escapeHtml(payload.message ?? '');
  const redirectUrl = payload.redirectUrl ? escapeHtml(payload.redirectUrl) : null;

  return `
    <div class="dsb-overlay">
      <div class="dsb-card" role="alertdialog" aria-modal="true">
        <div class="dsb-service">${serviceLabel}</div>
        <div class="dsb-reason">${reasonText}</div>
        <div class="dsb-message">${message}</div>
        <div class="dsb-actions">
          ${redirectUrl ? `<button class="dsb-button dsb-button--go" data-dsb-go="${redirectUrl}">Перейти</button>` : ''}
          <button class="dsb-button dsb-button--close" data-dsb-close>Закрыть вкладку</button>
        </div>
      </div>
    </div>
  `;
}

class DoomscrollOverlay {
  private host: HTMLDivElement | null = null;

  private ensureHost(): HTMLDivElement {
    if (this.host && this.host.isConnected) return this.host;
    const existing = document.getElementById(HOST_ID);
    if (existing) existing.remove();

    this.host = document.createElement('div');
    this.host.id = HOST_ID;
    document.documentElement.appendChild(this.host);
    return this.host;
  }

  show(payload: OverlayMessage): void {
    const host = this.ensureHost();
    // Shadow DOM изолирует стили от стилей сайта и наоборот.
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${OVERLAY_STYLES}</style>${overlayHtml(payload)}`;

    shadow.querySelector('[data-dsb-close]')?.addEventListener('click', () => {
      void chrome.runtime.sendMessage({ type: 'dsb:close-tab' });
    });
    shadow.querySelector('[data-dsb-go]')?.addEventListener('click', (event) => {
      const url = (event.currentTarget as HTMLElement).getAttribute('data-dsb-go');
      if (url) window.location.assign(url);
    });
  }

  hide(): void {
    this.host?.remove();
    this.host = null;
  }
}

const overlay = new DoomscrollOverlay();

export default defineContentScript({
  matches: [
    '*://www.youtube.com/*',
    '*://m.youtube.com/*',
    '*://www.instagram.com/*',
    '*://instagram.com/*',
    '*://www.tiktok.com/*',
    '*://tiktok.com/*',
  ],
  runAt: 'document_idle',

  main() {
    // Fallback-инъекция через chrome.scripting не должна дублировать
    // слушателей и heartbeat — метка в DOM видна из всех миров.
    if (document.documentElement.hasAttribute('data-dsb-content')) return;
    document.documentElement.setAttribute('data-dsb-content', '');

    sendTabState();

    document.addEventListener('visibilitychange', sendTabState);
    window.addEventListener('focus', sendTabState);
    window.addEventListener('blur', sendTabState);

    // SPA-навигация (YouTube/Instagram/TikTok не перезагружают страницу):
    // сообщаем background новый URL сразу, не дожидаясь heartbeat.
    const originalPushState = history.pushState.bind(history);
    history.pushState = (...args: Parameters<History['pushState']>) => {
      originalPushState(...args);
      sendTabState();
    };
    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = (...args: Parameters<History['replaceState']>) => {
      originalReplaceState(...args);
      sendTabState();
    };
    window.addEventListener('popstate', sendTabState);
    window.addEventListener('yt-navigate-finish', sendTabState);

    // Heartbeat: восстанавливает связь после перезапуска service worker
    // и подстраховывает от пропущенных событий visibility/focus.
    setInterval(sendTabState, 5000);

    chrome.runtime.onMessage.addListener((message: unknown) => {
      if (typeof message !== 'object' || message === null) return;
      const overlayMessage = message as OverlayMessage;
      // Проверка «на связи» от background: слушатель есть — скрипт подключён.
      if ((overlayMessage as { type?: unknown }).type === 'dsb:ping') return;
      if (overlayMessage.type !== 'dsb:overlay') return;

      if (overlayMessage.show) {
        overlay.show(overlayMessage);
      } else {
        overlay.hide();
      }
    });
  },
});
