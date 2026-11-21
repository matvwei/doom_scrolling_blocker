// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DoomscrollOverlay } from '../entrypoints/content';
import { playWarningSound } from '../core/warningSound';

vi.mock('../core/warningSound', () => ({ playWarningSound: vi.fn() }));

const payload = {
  type: 'dsb:overlay' as const,
  show: true,
  serviceLabel: 'YouTube Shorts',
  reasonText: 'Лимит сессии',
  message: 'Хватит doomscrollить',
};

describe('DoomscrollOverlay', () => {
  let overlay: DoomscrollOverlay;

  beforeEach(() => {
    vi.clearAllMocks();
    document.getElementById('dsb-overlay-host')?.remove();
    overlay = new DoomscrollOverlay();
  });

  afterEach(() => {
    overlay.hide();
    vi.restoreAllMocks();
  });

  it('подаёт сигнал один раз на показ и снова после скрытия', () => {
    overlay.show(payload);
    overlay.show(payload);
    overlay.show(payload);

    expect(playWarningSound).toHaveBeenCalledOnce();

    overlay.hide();
    overlay.show(payload);

    expect(playWarningSound).toHaveBeenCalledTimes(2);
  });

  it('восстанавливается после удаления и задаёт вопрос', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    overlay.show(payload);
    const removedHost = document.getElementById('dsb-overlay-host');

    removedHost?.remove();

    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledWith(
      'А точно ли ты хочешь продолжить дальше страдать фигней?',
    );
    const restoredHost = document.getElementById('dsb-overlay-host');
    expect(restoredHost).not.toBeNull();
    expect(restoredHost).not.toBe(removedHost);
    expect(restoredHost?.shadowRoot?.textContent).toContain('Хватит doomscrollить');
  });

  it('восстанавливает содержимое после изменения Shadow DOM', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    overlay.show(payload);
    const host = document.getElementById('dsb-overlay-host');

    host?.shadowRoot?.querySelector('.dsb-overlay')?.remove();

    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(document.getElementById('dsb-overlay-host')?.shadowRoot?.textContent).toContain(
      'Лимит сессии',
    );
  });

  it('штатное скрытие не считается вмешательством', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    overlay.show(payload);

    overlay.hide();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(confirm).not.toHaveBeenCalled();
    expect(document.getElementById('dsb-overlay-host')).toBeNull();
  });

  it('использует английские кнопки и вопрос при language=en', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    overlay.show({
      ...payload,
      language: 'en',
      reasonText: 'Session limit reached',
      redirectUrl: 'https://example.com',
    });

    const host = document.getElementById('dsb-overlay-host');
    expect(host?.shadowRoot?.textContent).toContain('Close tab');
    expect(host?.shadowRoot?.textContent).toContain('Go');

    host?.remove();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledWith('Are you sure you want to keep wasting your time?');
  });
});
