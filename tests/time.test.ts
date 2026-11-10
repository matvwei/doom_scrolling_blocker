import { describe, expect, it } from 'vitest';
import { formatClock, localDayKey } from '../core/time';

describe('localDayKey', () => {
  it('формирует ключ локального дня', () => {
    expect(localDayKey(new Date(2025, 10, 10, 23, 59, 59))).toBe('2025-11-10');
    expect(localDayKey(new Date(2025, 0, 5, 1, 0, 0))).toBe('2025-01-05');
  });

  it('принимает timestamp', () => {
    const ts = new Date(2025, 10, 10, 12, 0, 0).getTime();
    expect(localDayKey(ts)).toBe('2025-11-10');
  });
});

describe('formatClock', () => {
  it('форматирует минуты и секунды', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(599)).toBe('09:59');
  });

  it('форматирует часы, когда они есть', () => {
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(3661)).toBe('1:01:01');
  });

  it('не уходит в минус', () => {
    expect(formatClock(-10)).toBe('00:00');
  });
});
