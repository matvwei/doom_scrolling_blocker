import type { LimitReason } from './limits';

/** Content script → background: состояние видимости/фокуса документа вкладки. */
export interface TabStateMessage {
  type: 'dsb:tab-state';
  hidden: boolean;
  hasFocus: boolean;
}

/** Content script → background: закрыть текущую вкладку (кнопка overlay). */
export interface CloseTabMessage {
  type: 'dsb:close-tab';
}

/** Background → content script: «вы живы?» — проверка инъекции без побочных эффектов. */
export interface PingMessage {
  type: 'dsb:ping';
}

/** Background → content script: показать/скрыть блокирующий overlay. */
export interface OverlayMessage {
  type: 'dsb:overlay';
  show: boolean;
  /** Отслеживаемая цель (ServiceId встроенного сервиса или id custom-сайта). */
  targetId?: string;
  serviceLabel?: string;
  reason?: LimitReason;
  reasonText?: string;
  message?: string;
  redirectUrl?: string | null;
}

export type BackgroundMessage = TabStateMessage | CloseTabMessage | PingMessage;
export type ContentMessage = OverlayMessage;

export function isTabStateMessage(msg: unknown): msg is TabStateMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === 'dsb:tab-state'
  );
}

export function isCloseTabMessage(msg: unknown): msg is CloseTabMessage {
  return (
    typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'dsb:close-tab'
  );
}
