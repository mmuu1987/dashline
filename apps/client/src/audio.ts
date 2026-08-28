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
    this.beep(150, 0.06, 'sine', 0.05);
  }
  /** 宝石拾取：根据连击数按大调五声音阶攀升，极其悦耳 */
  coin(combo = 1): void {
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const note = scale[Math.min(combo - 1, scale.length - 1)]!;
    const f = 523.25 * Math.pow(2, note / 12);
    this.beep(f, 0.11, 'sine', 0.045);
    // 高连击叠加晶莹八度谐波
    if (combo >= 4) {
      setTimeout(() => this.beep(f * 2, 0.08, 'triangle', 0.025), 25);
    }
  }
  crash(): void {
    this.beep(220, 0.3, 'sawtooth', 0.07, 55);
  }
  /** 终点盛典：宏大辉煌胜利和弦（C大调多声部齐奏） */
  finish(): void {
    const notes = [
      { f: 523.25, d: 0 },
      { f: 659.25, d: 80 },
      { f: 783.99, d: 160 },
      { f: 1046.5, d: 240 },
      { f: 1318.5, d: 340 },
      { f: 1567.98, d: 440 },
      { f: 2093.0, d: 560 },
    ];
    for (const n of notes) {
      setTimeout(() => {
        this.beep(n.f, 0.35, 'triangle', 0.06);
        this.beep(n.f * 0.5, 0.45, 'sine', 0.04);
      }, n.d);
    }
  }
  /** 极限擦刺：惊险金属电光微刮擦 */
  nearmiss(): void {
    this.beep(1760, 0.05, 'sawtooth', 0.03, 3520);
  }
  /** 拾取护盾星：高贵空灵水晶能量共鸣 */
  shield(): void {
    this.beep(587.33, 0.12, 'sine', 0.05);
    setTimeout(() => this.beep(880.0, 0.18, 'sine', 0.06), 80);
    setTimeout(() => this.beep(1174.66, 0.25, 'triangle', 0.05), 160);
  }
  /** 护盾碎裂：强力晶体破碎与能量震荡 */
  shieldBreak(): void {
    this.beep(400, 0.2, 'sawtooth', 0.06, 120);
    const ctx = this.ctx;
    if (ctx && this.master && this.noiseBuf && ctx.state === 'running') {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      src.connect(g).connect(this.master);
      src.start(t);
    }
  }
  /** 重力翻转：深邃引力波呼啸 */
  portal(): void {
    this.beep(180, 0.32, 'sine', 0.07, 720);
  }
  /** 磁铁激活：高频磁电脉冲 */
  magnet(): void {
    this.beep(440, 0.15, 'triangle', 0.05, 880);
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

  // ---- 蓄力音（随进度爬升的持续音 + 满蓄释放"锵"）----
  private chargeOsc: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;

  chargeStart(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running' || this.chargeOsc) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = 300;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.028, ctx.currentTime + 0.05);
    o.connect(g).connect(this.master);
    o.start();
    this.chargeOsc = o;
    this.chargeGain = g;
  }

  chargeUpdate(progress: number): void {
    if (!this.chargeOsc || !this.ctx) return;
    // 300Hz → 1000Hz 随蓄力进度爬升，耳朵能直接读出档位
    this.chargeOsc.frequency.setTargetAtTime(
      300 + Math.min(1, Math.max(0, progress)) * 700,
      this.ctx.currentTime,
      0.02,
    );
  }

  chargeEnd(releasedFull: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.chargeOsc && this.chargeGain) {
      const t = ctx.currentTime;
      this.chargeGain.gain.setTargetAtTime(0.0001, t, 0.015);
      const o = this.chargeOsc;
      setTimeout(() => {
        try {
          o.stop();
        } catch {
          /* 已停止 */
        }
      }, 80);
      this.chargeOsc = null;
      this.chargeGain = null;
    }
    if (releasedFull) {
      // 满蓄释放：明亮双音"锵"
      this.beep(1318, 0.1, 'sine', 0.055);
      setTimeout(() => this.beep(1760, 0.14, 'sine', 0.045), 60);
    }
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
