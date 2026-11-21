function closeContext(context: AudioContext): void {
  void context.close().catch(() => {});
}

export function playWarningSound(): void {
  if (typeof AudioContext === 'undefined') return;

  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    return;
  }

  const start = () => {
    if (context.state !== 'running') {
      closeContext(context);
      return;
    }

    try {
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(660, now);
      oscillator.frequency.setValueAtTime(880, now + 0.16);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      gain.gain.setValueAtTime(0.12, now + 0.28);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => closeContext(context);
      oscillator.start(now);
      oscillator.stop(now + 0.41);
    } catch {
      closeContext(context);
    }
  };

  if (context.state === 'suspended') {
    void context.resume().then(start).catch(() => closeContext(context));
  } else {
    start();
  }
}
