import { describe, expect, it } from 'vitest';
import {
  emptyServiceState,
  getExceeded,
  rehydrateServiceState,
  remainingTime,
  SESSION_RESET_AFTER_MS,
  tickServiceState,
  type ServiceState,
} from '../core/limits';
import { localDayKey } from '../core/time';

const LIMITS = { sessionLimitMinutes: 15, dailyLimitMinutes: 45, enabled: true };
const T0 = new Date('2025-11-10T12:00:00').getTime();
const MIN = 60_000;

function stateAt(partial: Partial<ServiceState>, now = T0): ServiceState {
  return { ...emptyServiceState(now), ...partial };
}

describe('tickServiceState: накопление и превышение', () => {
  it('засчитывает активные секунды в сессию и день', () => {
    const result = tickServiceState(emptyServiceState(T0), LIMITS, { activeSeconds: 10, anyTabOpen: true }, T0);
    expect(result.state.sessionSeconds).toBe(10);
    expect(result.state.dailySeconds).toBe(10);
    expect(result.exceeded).toBeNull();
    expect(result.newlyExceeded).toBeNull();
    expect(result.state.lastTrackedAt).toBe(T0);
  });

  it('не засчитывает время неактивной вкладки', () => {
    const result = tickServiceState(emptyServiceState(T0), LIMITS, { activeSeconds: 0, anyTabOpen: true }, T0);
    expect(result.state.sessionSeconds).toBe(0);
    expect(result.state.dailySeconds).toBe(0);
    expect(result.state.lastTrackedAt).toBeNull();
  });

  it('срабатывает на лимит сессии и сообщает о нём один раз', () => {
    let state = emptyServiceState(T0);
    let result = tickServiceState(state, LIMITS, { activeSeconds: 899, anyTabOpen: true }, T0);
    expect(result.exceeded).toBeNull();

    result = tickServiceState(result.state, LIMITS, { activeSeconds: 1, anyTabOpen: true }, T0 + 1000);
    expect(result.exceeded).toBe('session');
    expect(result.newlyExceeded).toBe('session');
    expect(result.state.blockedReason).toBe('session');

    const again = tickServiceState(result.state, LIMITS, { activeSeconds: 1, anyTabOpen: true }, T0 + 2000);
    expect(again.exceeded).toBe('session');
    expect(again.newlyExceeded).toBeNull();
    expect(again.unblocked).toBe(false);
  });

  it('срабатывает на дневной лимит, когда сессионный не исчерпан', () => {
    const state = stateAt({ sessionSeconds: 100, dailySeconds: 45 * 60 - 1, lastTrackedAt: T0 });
    const result = tickServiceState(state, LIMITS, { activeSeconds: 1, anyTabOpen: true }, T0 + 1000);
    expect(result.exceeded).toBe('daily');
    expect(result.newlyExceeded).toBe('daily');
    expect(result.state.blockedReason).toBe('daily');
  });

  it('сессия имеет приоритет, если исчерпаны оба лимита', () => {
    const state = stateAt({
      sessionSeconds: 15 * 60,
      dailySeconds: 45 * 60,
      lastTrackedAt: T0,
      blockedReason: null,
    });
    const result = tickServiceState(state, LIMITS, { activeSeconds: 1, anyTabOpen: true }, T0 + 1000);
    expect(result.exceeded).toBe('session');
  });
});

describe('tickServiceState: снятие и повторная блокировка', () => {
  it('уменьшение лимита ниже текущего значения применяется при следующей проверке', () => {
    const state = stateAt({ sessionSeconds: 800, dailySeconds: 800, lastTrackedAt: T0 });
    const result = tickServiceState(
      state,
      { sessionLimitMinutes: 10, dailyLimitMinutes: 45, enabled: true },
      { activeSeconds: 0, anyTabOpen: true },
      T0 + 1000,
    );
    expect(result.exceeded).toBe('session');
    expect(result.newlyExceeded).toBe('session');
  });

  it('увеличение лимита снимает блокировку', () => {
    const state = stateAt({
      sessionSeconds: 900,
      dailySeconds: 900,
      lastTrackedAt: T0,
      blockedReason: 'session',
    });
    const result = tickServiceState(
      state,
      { sessionLimitMinutes: 30, dailyLimitMinutes: 45, enabled: true },
      { activeSeconds: 0, anyTabOpen: true },
      T0 + 1000,
    );
    expect(result.exceeded).toBeNull();
    expect(result.unblocked).toBe(true);
    expect(result.state.blockedReason).toBeNull();
  });

  it('уход со всех страниц сервиса снимает блокировку, повторный вход блокирует снова', () => {
    const state = stateAt({
      sessionSeconds: 900,
      dailySeconds: 900,
      lastTrackedAt: T0,
      blockedReason: 'session',
    });

    const away = tickServiceState(state, LIMITS, { activeSeconds: 0, anyTabOpen: false }, T0 + 1000);
    expect(away.state.blockedReason).toBeNull();
    expect(away.unblocked).toBe(true);

    const back = tickServiceState(away.state, LIMITS, { activeSeconds: 1, anyTabOpen: true }, T0 + 2000);
    expect(back.exceeded).toBe('session');
    expect(back.newlyExceeded).toBe('session');
  });
});

describe('сброс сессии после 10 минут неактивности', () => {
  it('сбрасывает сессию и снимает session-блокировку после неактивности', () => {
    const state = stateAt({
      sessionSeconds: 890,
      dailySeconds: 890,
      lastTrackedAt: T0,
      blockedReason: 'session',
    });
    const result = tickServiceState(
      state,
      LIMITS,
      { activeSeconds: 0, anyTabOpen: true },
      T0 + SESSION_RESET_AFTER_MS + 1000,
    );
    expect(result.state.sessionSeconds).toBe(0);
    expect(result.state.blockedReason).toBeNull();
    // Дневной счётчик сохраняется: лимит 45 минут всё ещё не исчерпан.
    expect(result.state.dailySeconds).toBe(890);
  });

  it('ровно 10 минут неактивности сессию ещё не сбрасывают', () => {
    const state = stateAt({ sessionSeconds: 100, dailySeconds: 100, lastTrackedAt: T0 });
    const result = tickServiceState(
      state,
      LIMITS,
      { activeSeconds: 0, anyTabOpen: true },
      T0 + SESSION_RESET_AFTER_MS,
    );
    expect(result.state.sessionSeconds).toBe(100);
  });

  it('отсутствие активности вообще (lastTrackedAt=null) обнуляет сессию', () => {
    const state = rehydrateServiceState({ sessionSeconds: 500, dailySeconds: 500 }, T0);
    expect(state.sessionSeconds).toBe(0);
    expect(state.dailySeconds).toBe(500);
  });
});

describe('сброс дня в локальную полночь', () => {
  it('rehydrateServiceState обнуляет дневной и сессионный счётчики при смене дня', () => {
    const today = new Date('2025-11-10T23:59:00').getTime();
    const afterMidnight = new Date('2025-11-11T00:01:00').getTime();
    const state = stateAt(
      {
        sessionSeconds: 100,
        dailySeconds: 2000,
        dayKey: localDayKey(today),
        lastTrackedAt: today,
        blockedReason: 'daily',
      },
      today,
    );

    const restored = rehydrateServiceState(state, afterMidnight);
    expect(restored.dayKey).toBe(localDayKey(afterMidnight));
    expect(restored.dailySeconds).toBe(0);
    expect(restored.sessionSeconds).toBe(0);
    expect(restored.blockedReason).toBeNull();
  });

  it('сохраняет счётчики внутри того же дня (перезапуск браузера)', () => {
    const later = T0 + 5 * MIN;
    const state = stateAt({ sessionSeconds: 300, dailySeconds: 300, lastTrackedAt: T0 });
    const restored = rehydrateServiceState(state, later);
    expect(restored.sessionSeconds).toBe(300);
    expect(restored.dailySeconds).toBe(300);
  });

  it('переживает перезапуск: повреждённые значения обнуляются', () => {
    const restored = rehydrateServiceState(
      {
        sessionSeconds: Number.NaN,
        dailySeconds: -50,
        dayKey: 'not-a-day',
        lastTrackedAt: Number.POSITIVE_INFINITY,
        blockedReason: 'hack' as never,
      },
      T0,
    );
    expect(restored.sessionSeconds).toBe(0);
    expect(restored.dailySeconds).toBe(0);
    expect(restored.dayKey).toBe(localDayKey(T0));
    expect(restored.lastTrackedAt).toBeNull();
    expect(restored.blockedReason).toBeNull();
  });

  it('игнорирует полностью пустое сохранённое состояние', () => {
    expect(rehydrateServiceState(null, T0)).toEqual(emptyServiceState(T0));
    expect(rehydrateServiceState(undefined, T0)).toEqual(emptyServiceState(T0));
  });
});

describe('отключённый сервис (enabled=false)', () => {
  const DISABLED = { sessionLimitMinutes: 15, dailyLimitMinutes: 45, enabled: false };

  it('не засчитывает время и не блокирует, даже когда счётчики за лимитом', () => {
    const state = stateAt({ sessionSeconds: 900, dailySeconds: 900, lastTrackedAt: T0 });
    const result = tickServiceState(state, DISABLED, { activeSeconds: 10, anyTabOpen: true }, T0 + 1000);
    expect(result.state.sessionSeconds).toBe(900);
    expect(result.state.dailySeconds).toBe(900);
    expect(result.exceeded).toBeNull();
    expect(result.newlyExceeded).toBeNull();
    expect(result.state.blockedReason).toBeNull();
  });

  it('снимает активную блокировку и сигналит unblocked', () => {
    const state = stateAt({
      sessionSeconds: 900,
      dailySeconds: 900,
      lastTrackedAt: T0,
      blockedReason: 'session',
    });
    const result = tickServiceState(state, DISABLED, { activeSeconds: 0, anyTabOpen: true }, T0 + 1000);
    expect(result.state.blockedReason).toBeNull();
    expect(result.unblocked).toBe(true);
    expect(result.exceeded).toBeNull();
  });

  it('blockedReason не восстанавливается по старым счётчикам пока сервис выключен', () => {
    let state = stateAt({
      sessionSeconds: 900,
      dailySeconds: 900,
      lastTrackedAt: T0,
      blockedReason: 'session',
    });
    for (let i = 1; i <= 3; i += 1) {
      const result = tickServiceState(state, DISABLED, { activeSeconds: 5, anyTabOpen: true }, T0 + i * 1000);
      state = result.state;
      expect(result.state.blockedReason).toBeNull();
      expect(result.state.sessionSeconds).toBe(900);
    }
  });

  it('при повторном включении счётчики применяются к текущим лимитам', () => {
    let state = stateAt({ sessionSeconds: 900, dailySeconds: 900, lastTrackedAt: T0 });

    // Лимит выше счётчика — после enable блокировки нет.
    let result = tickServiceState(
      state,
      { sessionLimitMinutes: 30, dailyLimitMinutes: 45, enabled: true },
      { activeSeconds: 0, anyTabOpen: true },
      T0 + 1000,
    );
    state = result.state;
    expect(result.exceeded).toBeNull();
    expect(result.state.blockedReason).toBeNull();

    // Лимит вернули к исходному — счётчики сохранились, блокировка вернулась.
    result = tickServiceState(state, LIMITS, { activeSeconds: 0, anyTabOpen: true }, T0 + 2000);
    expect(result.exceeded).toBe('session');
    expect(result.newlyExceeded).toBe('session');
    expect(result.state.blockedReason).toBe('session');
  });
});

describe('нулевые лимиты (0 — блокировать сразу)', () => {
  const ZERO_SESSION = { sessionLimitMinutes: 0, dailyLimitMinutes: 45, enabled: true };
  const ZERO_BOTH = { sessionLimitMinutes: 0, dailyLimitMinutes: 0, enabled: true };

  it('превышение вычисляется немедленно, без накопленного времени', () => {
    const result = tickServiceState(emptyServiceState(T0), ZERO_SESSION, { activeSeconds: 0, anyTabOpen: true }, T0);
    expect(result.exceeded).toBe('session');
    expect(result.newlyExceeded).toBe('session');
    expect(result.state.blockedReason).toBe('session');
  });

  it('getExceeded на пустом состоянии с лимитом 0 — session (приоритет сохраняется при обоих 0)', () => {
    expect(getExceeded(emptyServiceState(T0), ZERO_SESSION)).toBe('session');
    expect(getExceeded(emptyServiceState(T0), ZERO_BOTH)).toBe('session');
    expect(getExceeded({ sessionSeconds: 10, dailySeconds: 10 }, ZERO_BOTH)).toBe('session');
  });

  it('дневной 0 с ненулевой сессией блокирует по daily', () => {
    const zeroDaily = { sessionLimitMinutes: 15, dailyLimitMinutes: 0, enabled: true };
    expect(getExceeded(emptyServiceState(T0), zeroDaily)).toBe('daily');
    const result = tickServiceState(emptyServiceState(T0), zeroDaily, { activeSeconds: 0, anyTabOpen: true }, T0);
    expect(result.exceeded).toBe('daily');
  });

  it('блокировка держится и при простое: зачёлка не дёргается между тиками', () => {
    let result = tickServiceState(emptyServiceState(T0), ZERO_SESSION, { activeSeconds: 0, anyTabOpen: true }, T0);
    expect(result.state.blockedReason).toBe('session');
    expect(result.newlyExceeded).toBe('session');

    result = tickServiceState(result.state, ZERO_SESSION, { activeSeconds: 0, anyTabOpen: true }, T0 + 1000);
    expect(result.state.blockedReason).toBe('session');
    expect(result.newlyExceeded).toBeNull();
    expect(result.unblocked).toBe(false);
    expect(result.exceeded).toBe('session');
  });

  it('уход со всех страниц снимает блокировку, повторный вход блокирует снова', () => {
    const blocked = tickServiceState(emptyServiceState(T0), ZERO_SESSION, { activeSeconds: 0, anyTabOpen: true }, T0);
    const away = tickServiceState(blocked.state, ZERO_SESSION, { activeSeconds: 0, anyTabOpen: false }, T0 + 1000);
    expect(away.state.blockedReason).toBeNull();
    const back = tickServiceState(away.state, ZERO_SESSION, { activeSeconds: 0, anyTabOpen: true }, T0 + 2000);
    expect(back.newlyExceeded).toBe('session');
  });

  it('disabled с нулевыми лимитами не блокирует', () => {
    const disabled = { sessionLimitMinutes: 0, dailyLimitMinutes: 0, enabled: false };
    const result = tickServiceState(emptyServiceState(T0), disabled, { activeSeconds: 5, anyTabOpen: true }, T0);
    expect(result.exceeded).toBeNull();
    expect(result.state.blockedReason).toBeNull();
    expect(getExceeded(emptyServiceState(T0), disabled)).toBeNull();
  });

  it('remainingTime с лимитом 0 — ноль секунд', () => {
    const remaining = remainingTime(emptyServiceState(T0), ZERO_SESSION);
    expect(remaining.sessionSeconds).toBe(0);
    expect(remaining.dailySeconds).toBe(45 * 60);
  });
});

describe('remainingTime', () => {
  it('считает остаток до лимитов и не уходит в минус', () => {
    const state = stateAt({ sessionSeconds: 10 * 60, dailySeconds: 44 * 60 + 30 });
    const remaining = remainingTime(state, LIMITS);
    expect(remaining.sessionSeconds).toBe(5 * 60);
    expect(remaining.dailySeconds).toBe(30);

    const over = remainingTime(stateAt({ sessionSeconds: 9999, dailySeconds: 9999 }), LIMITS);
    expect(over.sessionSeconds).toBe(0);
    expect(over.dailySeconds).toBe(0);
  });
});
