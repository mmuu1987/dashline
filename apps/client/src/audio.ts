/** 极简合成音效：零资源文件，全部 WebAudio 振荡器。仅表现层，不影响确定性。 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private combo = 0;

  unlock(): void {
    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private beep(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    slideTo?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  jump(): void {
    this.beep(460, 0.12, 'square', 0.04, 720);
  }
  land(): void {
    this.combo = 0;
    this.beep(150, 0.06, 'sine', 0.05);
  }
  coin(): void {
    this.combo++;
    const f = 620 * Math.pow(1.059, Math.min(this.combo, 24)); // 连击音高递增
    this.beep(f, 0.09, 'square', 0.035);
  }
  crash(): void {
    this.beep(220, 0.3, 'sawtooth', 0.07, 55);
  }
  finish(): void {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.beep(f, 0.16, 'square', 0.05), i * 110));
  }
}
