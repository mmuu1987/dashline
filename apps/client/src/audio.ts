/**
 * 零资源音频：WebAudio 合成音效 + 芯片风 BGM 循环。
 * 全部运行时生成（无素材文件 / 无版权负担 / Safari 兼容）。
 * unlock() 须在用户手势后调用；静音状态持久化 localStorage。
 */
const LS_KEY = 'dl_mute';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private combo = 0;
  private muted = false;
  /** BGM 调度器 */
  private step = 0;
  private nextT = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    try {
      this.muted = localStorage.getItem(LS_KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** 用户手势后调用：创建/恢复 AudioContext 并启动 BGM */
  unlock(): void {
    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      // 噪声缓冲（踩镲用）
      const len = Math.floor(this.ctx.sampleRate * 0.06);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.startMusic();
  }

  /** 切换静音，返回切换后的状态 */
  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(LS_KEY, this.muted ? '1' : '0');
    } catch {
      /* 忽略 */
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
    }
    if (this.muted) this.stopMusic();
    else this.startMusic();
    return this.muted;
  }

  private beep(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    slideTo?: number,
    dest?: AudioNode,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // ---- 游戏音效 ----
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
  /** 拾取二段跳环：双升音 */
  ring(): void {
    this.beep(880, 0.08, 'sine', 0.05);
    setTimeout(() => this.beep(1318, 0.14, 'sine', 0.05), 70);
  }
  /** 空中二段跳：弹性上滑 */
  djump(): void {
    this.beep(330, 0.14, 'triangle', 0.06, 660);
  }
  /** 加速带触发：引擎式上升轰鸣 */
  boost(): void {
    this.beep(200, 0.28, 'sawtooth', 0.045, 900);
  }
  /** 木板碎裂：低闷短噪 */
  crumble(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(g).connect(this.master);
    src.start(t);
  }

  // ---- BGM：Am-F-C-G 芯片小循环（132bpm，八分音符步进）----
  private static readonly BASS_ROOTS = [45, 45, 41, 41, 48, 48, 43, 43]; // A2 F2 C3 G2
  private static readonly LEAD = [
    // 每行一小节（8 步），-1 = 休止；A 小调五声风
    69, -1, 72, -1, 76, -1, 72, -1,
    74, -1, 72, -1, 69, -1, -1, -1,
    65, -1, 69, -1, 72, -1, 69, -1,
    77, -1, 76, -1, 74, -1, 72, -1,
    76, -1, 72, -1, 67, -1, 72, -1,
    76, -1, 79, -1, 76, -1, 72, -1,
    74, -1, 71, -1, 67, -1, 71, -1,
    74, -1, 79, -1, 83, -1, -1, -1,
  ];

  private midi(m: number): number {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  private scheduleStep(idx: number, t: number): void {
    const ctx = this.ctx!;
    const bar = Math.floor(idx / 8) % 8;
    const inBar = idx % 8;
    const STEP_S = 60 / 132 / 2;
    // 贝斯：根音与五度交替（三角波）
    const root = Sfx.BASS_ROOTS[bar]!;
    const bassNote = inBar % 4 === 0 ? root : inBar % 2 === 0 ? root + 7 : -1;
    if (bassNote > 0) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = this.midi(bassNote);
      g.gain.setValueAtTime(0.07, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + STEP_S * 0.95);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + STEP_S);
    }
    // 主旋律（方波）
    const lead = Sfx.LEAD[idx % Sfx.LEAD.length]!;
    if (lead >= 0) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = this.midi(lead);
      g.gain.setValueAtTime(0.028, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + STEP_S * 1.7);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + STEP_S * 1.8);
    }
    // 反拍踩镲（噪声）
    if (inBar % 2 === 1 && this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.02, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(g).connect(this.master!);
      src.start(t);
    }
  }

  startMusic(): void {
    if (!this.ctx || this.muted || this.timer) return;
    this.nextT = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      const STEP = 60 / 132 / 2;
      while (this.nextT < ctx.currentTime + 0.15) {
        this.scheduleStep(this.step, this.nextT);
        this.step = (this.step + 1) % (8 * 8);
        this.nextT += STEP;
      }
    }, 40);
  }

  stopMusic(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
