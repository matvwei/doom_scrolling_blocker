import { afterEach, describe, expect, it, vi } from 'vitest';
import { playWarningSound } from '../core/warningSound';

function makeAudioContext(initialState: 'running' | 'suspended' = 'running') {
  const oscillator = {
    type: '',
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
  const gain = {
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  };
  const context = {
    state: initialState as AudioContextState,
    currentTime: 10,
    destination: {},
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    close: vi.fn(async () => {
      context.state = 'closed';
    }),
  };

  return { context, oscillator, gain };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('playWarningSound', () => {
  it('проигрывает короткий двухтональный сигнал и освобождает AudioContext', () => {
    const { context, oscillator, gain } = makeAudioContext();
    vi.stubGlobal('AudioContext', vi.fn(() => context));

    playWarningSound();

    expect(oscillator.frequency.setValueAtTime).toHaveBeenNthCalledWith(1, 660, 10);
    expect(oscillator.frequency.setValueAtTime).toHaveBeenNthCalledWith(2, 880, 10.16);
    expect(oscillator.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).toHaveBeenCalledWith(context.destination);
    expect(oscillator.start).toHaveBeenCalledWith(10);
    expect(oscillator.stop).toHaveBeenCalledWith(10.41);

    oscillator.onended?.();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('сначала возобновляет приостановленный AudioContext', async () => {
    const { context, oscillator } = makeAudioContext('suspended');
    vi.stubGlobal('AudioContext', vi.fn(() => context));

    playWarningSound();

    await vi.waitFor(() => expect(oscillator.start).toHaveBeenCalledOnce());
    expect(context.resume).toHaveBeenCalledOnce();
  });

  it('не мешает показу предупреждения, если звук недоступен', async () => {
    const { context } = makeAudioContext('suspended');
    context.resume.mockRejectedValue(new Error('autoplay blocked'));
    vi.stubGlobal('AudioContext', vi.fn(() => context));

    expect(() => playWarningSound()).not.toThrow();

    await vi.waitFor(() => expect(context.close).toHaveBeenCalledOnce());
  });
});
