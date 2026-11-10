/** Ключ локального календарного дня, например "2025-11-10". Дневной лимит сбрасывается в локальную полночь. */
export function localDayKey(now: Date | number): string {
  const date = typeof now === 'number' ? new Date(now) : now;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Форматирует секунды как "MM:SS" или "H:MM:SS" — для оставшегося времени в popup. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
