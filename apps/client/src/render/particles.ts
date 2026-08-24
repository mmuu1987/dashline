/** 粒子系统：对象池化的 Sprite 粒子。落地尘 / 金币火花 / 撞击爆裂 / 终点彩带 / 拖尾。 */
import { Container, Sprite } from 'pixi.js';
import type { GameAssets } from './textures.js';

interface P {
  s: Sprite;
  vx: number;
  vy: number;
  g: number;
  t: number;
  life: number;
  spin: number;
  baseAlpha: number;
  shrink: boolean;
}

const CONFETTI_COLORS = [0xffd23f, 0x4fc3f7, 0xff6b9a, 0x7ddf72] as const;

export class Particles {
  readonly root = new Container();

  private pool: P[] = [];
  private live: P[] = [];

  constructor(private assets: GameAssets) {}

  private spawn(
    texIdx: 'whiteDot' | 'goldDot' | 'sparkle' | 'redTex' | 'confetti',
    tint: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    opts: { g?: number; life: number; scale: number; alpha?: number; spin?: number; add?: boolean; shrink?: boolean },
  ): void {
    const p = this.pool.pop() ?? { s: new Sprite(), vx: 0, vy: 0, g: 0, t: 0, life: 1, spin: 0, baseAlpha: 1, shrink: false };
    const tex = this.assets[texIdx];
    p.s.texture = tex;
    p.s.anchor?.set(0.5);
    p.s.position.set(x, y);
    p.s.scale.set(opts.scale);
    p.s.tint = tint;
    p.s.rotation = Math.random() * Math.PI * 2;
    p.s.alpha = opts.alpha ?? 1;
    p.s.blendMode = opts.add ? 'add' : 'normal';
    if (p.s.parent !== this.root) this.root.addChild(p.s);
    p.vx = vx;
    p.vy = vy;
    p.g = opts.g ?? 0;
    p.t = 0;
    p.life = opts.life;
    p.spin = opts.spin ?? 0;
    p.baseAlpha = opts.alpha ?? 1;
    p.shrink = opts.shrink ?? false;
    this.live.push(p);
  }

  /** 落地扬尘 */
  dust(x: number, y: number): void {
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.15 + Math.random() * 0.7) + (Math.random() < 0.5 ? Math.PI : 0);
      this.spawn('whiteDot', 0x8f7355, x + (Math.random() - 0.5) * 10, y - 2,
        Math.cos(a) * (30 + Math.random() * 50), -Math.abs(Math.sin(a)) * (20 + Math.random() * 40),
        { g: 140, life: 0.45 + Math.random() * 0.25, scale: 0.06 + Math.random() * 0.05, alpha: 0.55, shrink: true });
    }
  }

  /** 金币火花（additive 金光）*/
  coin(x: number, y: number): void {
    for (let i = 0; i < 9; i++) {
      const a = (Math.PI * 2 * i) / 9 + Math.random() * 0.4;
      const sp = 90 + Math.random() * 120;
      this.spawn(i % 3 === 0 ? 'sparkle' : 'goldDot', 0xffd23f, x, y,
        Math.cos(a) * sp, Math.sin(a) * sp,
        { g: 260, life: 0.55 + Math.random() * 0.2, scale: 0.16 + Math.random() * 0.12, add: true, shrink: true });
    }
  }

  /** 弹跳菇气浪：绿色光环向上喷发 */
  bouncePuff(x: number, y: number): void {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      const sp = 120 + Math.random() * 160;
      this.spawn(i % 2 === 0 ? 'sparkle' : 'whiteDot', 0x7ddf72, x + (Math.random() - 0.5) * 26, y,
        Math.cos(a) * sp * 0.4, Math.sin(a) * sp,
        { g: 300, life: 0.4 + Math.random() * 0.25, scale: 0.14 + Math.random() * 0.1, add: true, shrink: true });
    }
  }

  /** 木板碎屑：褐色小片四散坠落 */
  debris(x: number, y: number): void {
    for (let i = 0; i < 8; i++) {
      this.spawn('whiteDot', [0x8a6238, 0x6e4c2a, 0xa87b4a][i % 3]!, x + (Math.random() - 0.5) * 60, y,
        (Math.random() - 0.5) * 140, -40 - Math.random() * 90,
        { g: 900, life: 0.5 + Math.random() * 0.3, scale: 0.07 + Math.random() * 0.05, alpha: 0.95, spin: 8, shrink: false });
    }
  }

  /** 撞毁爆裂 */
  crash(x: number, y: number): void {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 240;
      this.spawn(i % 2 === 0 ? 'redTex' : 'whiteDot', i % 2 === 0 ? 0xffffff : 0xff8899, x, y,
        Math.cos(a) * sp, Math.sin(a) * sp - 60,
        { g: 500, life: 0.5 + Math.random() * 0.35, scale: 0.12 + Math.random() * 0.14, alpha: 0.95, shrink: false });
    }
  }

  /** 终点彩带 */
  finish(x: number, y: number): void {
    for (let i = 0; i < 30; i++) {
      const tint = CONFETTI_COLORS[i % CONFETTI_COLORS.length]!;
      this.spawn('confetti', tint, x + (Math.random() - 0.5) * 60, y - Math.random() * 40,
        (Math.random() - 0.5) * 220, -160 - Math.random() * 200,
        { g: 420, life: 1.4 + Math.random() * 0.6, scale: 0.5 + Math.random() * 0.5, alpha: 0.95, spin: (Math.random() - 0.5) * 14 });
    }
  }

  /** 跑动尾尘（小）*/
  runDust(x: number, y: number): void {
    this.spawn('whiteDot', 0xbfb49c, x, y,
      -(60 + Math.random() * 50), -(10 + Math.random() * 30),
      { g: 120, life: 0.35, scale: 0.05, alpha: 0.4, shrink: true });
  }

  /** 冲刺拖尾残影 */
  trail(x: number, y: number): void {
    this.spawn('whiteDot', 0x59d3ff, x, y, 0, 0,
      { life: 0.28, scale: 0.34, alpha: 0.32, shrink: true });
  }

  update(dtSec: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      p.t += dtSec;
      if (p.t >= p.life) {
        this.root.removeChild(p.s);
        this.live.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      p.vy += p.g * dtSec;
      p.s.x += p.vx * dtSec;
      p.s.y += p.vy * dtSec;
      p.s.rotation += p.spin * dtSec;
      const k = 1 - p.t / p.life;
      p.s.alpha = p.baseAlpha * k;
      if (p.shrink) p.s.scale.set(p.s.scale.x * (0.985));
    }
  }
}
