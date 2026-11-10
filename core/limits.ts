import type { ServiceConfig } from './config';
import { localDayKey } from './time';

export type LimitReason = 'session' | 'daily';

/** Сессия сбрасывается после 10 минут вне отслеживаемых страниц или неактивности. */
export const SESSION_RESET_AFTER_MS = 10 * 60 * 1000;

export interface ServiceState {
  /** Накопленное время текущей сессии, секунды. */
  sessionSeconds: number;
  /** Накопленное время за сегодня, секунды. */
  dailySeconds: number;
  /** Локальный день, за который считается dailySeconds. */
  dayKey: string;
  /** Момент последней засчитанной активности (мс с epoch), null — активности не было. */
  lastTrackedAt: number | null;
  /** Причина текущей блокировки; null — сервис не заблокирован. */
  blockedReason: LimitReason | null;
}

export function emptyServiceState(now: Date | number): ServiceState {
  return {
    sessionSeconds: 0,
    dailySeconds: 0,
    dayKey: localDayKey(now),
    lastTrackedAt: null,
    blockedReason: null,
  };
}

export interface TickInput {
  /** Сколько секунд активного просмотра прошло с прошлой проверки (0, если вкладка неактивна/скрыта или сервис выключен). */
  activeSeconds: number;
  /** Открыта ли сейчас хоть одна отслеживаемая страница сервиса. */
  anyTabOpen: boolean;
}

export interface TickResult {
  state: ServiceState;
  /** Причина превышения лимита прямо сейчас, null — лимиты не исчерпаны. */
  exceeded: LimitReason | null;
  /** Лимит только что превышен и блокировка ещё не показана — пора выполнить действие. */
  newlyExceeded: LimitReason | null;
  /** Блокировка снята (лимит больше не превышен или пользователь ушёл со всех страниц сервиса). */
  unblocked: boolean;
}

function clampSeconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Восстанавливает состояние из хранилища и приводит его в актуальное:
 * сбрасывает дневной счётчик в локальную полночь и сессию после 10 минут
 * без отслеживаемой активности. Чистая функция — легко тестируется.
 */
export function rehydrateServiceState(
  saved: Partial<ServiceState> | null | undefined,
  now: Date | number,
): ServiceState {
  const timestamp = typeof now === 'number' ? now : now.getTime();
  const today = localDayKey(now);
  const base = emptyServiceState(now);

  if (!saved || typeof saved !== 'object') return base;

  const state: ServiceState = {
    sessionSeconds: clampSeconds(saved.sessionSeconds),
    dailySeconds: clampSeconds(saved.dailySeconds),
    dayKey: typeof saved.dayKey === 'string' ? saved.dayKey : today,
    lastTrackedAt:
      typeof saved.lastTrackedAt === 'number' && Number.isFinite(saved.lastTrackedAt)
        ? saved.lastTrackedAt
        : null,
    blockedReason: saved.blockedReason === 'session' || saved.blockedReason === 'daily' ? saved.blockedReason : null,
  };

  // Новый локальный день — сбрасываем и дневной, и сессионный счётчики.
  if (state.dayKey !== today) {
    state.dayKey = today;
    state.dailySeconds = 0;
    state.sessionSeconds = 0;
    state.blockedReason = null;
    return state;
  }

  // 10+ минут без засчитанной активности — сессия начинается заново.
  if (state.lastTrackedAt === null || timestamp - state.lastTrackedAt > SESSION_RESET_AFTER_MS) {
    state.sessionSeconds = 0;
    // Лимит по новой сессии уже не превышен — снимаем блокировку,
    // дневной лимит проверится заново на следующем тике.
    if (state.blockedReason === 'session') state.blockedReason = null;
  }

  return state;
}

/**
 * Чистая проверка превышения лимитов по текущим счётчикам без мутации
 * состояния. С лимитом 0 превышение есть всегда (0 >= 0) — это и даёт
 * немедленную блокировку при входе на отслеживаемую страницу.
 */
export function getExceeded(
  state: Pick<ServiceState, 'sessionSeconds' | 'dailySeconds'>,
  config: Pick<ServiceConfig, 'sessionLimitMinutes' | 'dailyLimitMinutes' | 'enabled'>,
): LimitReason | null {
  if (!config.enabled) return null;
  if (state.sessionSeconds >= config.sessionLimitMinutes * 60) return 'session';
  if (state.dailySeconds >= config.dailyLimitMinutes * 60) return 'daily';
  return null;
}

/**
 * Один шаг конечного автомата лимитов: засчитывает активные секунды,
 * определяет превышение и моменты показа/снятия блокировки.
 *
 * Семантика `enabled=false` явная: время не засчитывается, превышение
 * не вычисляется, активная блокировка снимается (unblocked), счётчики
 * сохраняются — при повторном включении лимиты применяются к ним заново.
 */
export function tickServiceState(
  previous: ServiceState,
  config: Pick<ServiceConfig, 'sessionLimitMinutes' | 'dailyLimitMinutes' | 'enabled'>,
  input: TickInput,
  now: Date | number,
): TickResult {
  let state = rehydrateServiceState(previous, now);
  // «Было заблокировано» берём из состояния ДО rehydrate: сброс сессии внутри
  // rehydrate не должен маскировать активную блокировку (иначе лимит 0
  // при простое пересоздавал бы блокировку на каждом тике).
  const wasBlocked: LimitReason | null = previous.blockedReason ?? null;

  if (config.enabled && input.activeSeconds > 0) {
    const timestamp = typeof now === 'number' ? now : now.getTime();
    const delta = Math.floor(input.activeSeconds);
    state.sessionSeconds += delta;
    state.dailySeconds += delta;
    state.lastTrackedAt = timestamp;
  }

  const exceeded = getExceeded(state, config);

  const newlyExceeded = exceeded !== null && wasBlocked === null ? exceeded : null;

  // Если пользователь ушёл со всех страниц сервиса — снимаем блокировку,
  // чтобы при повторном входе лимит сработал снова.
  if (!input.anyTabOpen) {
    state.blockedReason = null;
  } else if (exceeded !== null) {
    state.blockedReason = exceeded;
  } else {
    state.blockedReason = null;
  }

  return {
    state,
    exceeded: input.anyTabOpen ? exceeded : null,
    newlyExceeded: input.anyTabOpen ? newlyExceeded : null,
    unblocked: wasBlocked !== null && state.blockedReason === null,
  };
}

export interface RemainingTime {
  sessionSeconds: number;
  dailySeconds: number;
}

/** Оставшееся время до исчерпания лимитов (не меньше нуля) — для popup. */
export function remainingTime(state: ServiceState, config: Pick<ServiceConfig, 'sessionLimitMinutes' | 'dailyLimitMinutes'>): RemainingTime {
  return {
    sessionSeconds: Math.max(0, config.sessionLimitMinutes * 60 - state.sessionSeconds),
    dailySeconds: Math.max(0, config.dailyLimitMinutes * 60 - state.dailySeconds),
  };
}

export function reasonLabel(reason: LimitReason, config: Pick<ServiceConfig, 'sessionLimitMinutes' | 'dailyLimitMinutes'>): string {
  return reason === 'session'
    ? `Лимит сессии (${config.sessionLimitMinutes} мин) исчерпан`
    : `Дневной лимит (${config.dailyLimitMinutes} мин) исчерпан`;
}
