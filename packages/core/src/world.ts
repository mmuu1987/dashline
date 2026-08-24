/**
 * 确定性模拟核 —— 整个架构的地基。
 * 规则（CI 强制）：
 *  1. 固定步长 STEP_S，时间只来自 tick 计数，禁 Date.now/performance.now；
 *  2. 随机只允许 shared/prng 的 splitmix32；
 *  3. 本文件禁止任何 DOM/BOM/网络访问；
 *  4. 同一 (seed, 输入流) 在浏览器与 Node 中逐位一致 —— 服务端重放验证的前提。
 */
import {
  BUFFER_TICKS,
  COYOTE_TICKS,
  HOLD_MAX_TICKS,
  IN_DOWN_HELD,
  IN_JUMP_HELD,
  IN_JUMP_PRESS,
  STEP_S,
  TICK_RATE,
} from '@dashline/shared';
import { GROUND_Y, PIT_Y, buildTrack, type Track } from './chunks.js';

export { GROUND_Y, PIT_Y } from './chunks.js';
export type { Track, GroundSeg, Hazard, Coin, Plat, Pad } from './chunks.js';
export { PLAYER_R, CRUMBLE_TICKS, bounceV } from './tuning.js';
export { TUNING, tapJumpHeight, holdJumpHeight } from './tuning.js';

import { PLAYER_R, TUNING, CRUMBLE_TICKS, bounceV } from './tuning.js';

export const START_X = 80;
export const START_Y = GROUND_Y - PLAYER_R;

export type SimEvent =
  | { type: 'jump' }
  | { type: 'land' }
  | { type: 'coin'; index: number }
  | { type: 'crash'; cause: 'spike' | 'pit' }
  | { type: 'bounce' }
  | { type: 'crumble'; index: number }
  | { type: 'finish' };

export interface WorldSnapshot {
  tick: number;
  x: number;
  y: number;
  vy: number;
  grounded: boolean;
  alive: boolean;
  finished: boolean;
  score: number;
  timeMs: number;
  distanceM: number;
  coinCount: number;
  /** 已碎裂的碎裂板下标（渲染层据此隐藏） */
  crumblesBroken: readonly number[];
}

const FINISH_BASE_SCORE = 10_000_000;

function circleHitsRect(
  cx: number,
  cy: number,
  cr: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  const nx = cx < rx ? rx : cx > rx + rw ? rx + rw : cx;
  const ny = cy < ry ? ry : cy > ry + rh ? ry + rh : cy;
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < cr * cr;
}

export class World {
  // 供 clone() 一次性赋值，构造后不再变更
  seed: bigint;
  track: Track;

  tick = 0;
  private _x = START_X;
  private _y = START_Y;
  private _vy = 0;
  private _grounded = true;
  private _alive = true;
  private _finished = false;
  private _coinsGot = 0;
  private _score = 0;
  private coyote = COYOTE_TICKS;
  private buffer = 0;
  private holding = false;
  private holdTicks = 0;
  /** 碎裂板剩余 tick：-2 未触发 / -1 非碎裂板 / >0 倒计时中 / 0 已碎 */
  private platHp: number[] = [];
  private evq: SimEvent[] = [];

  constructor(seed: bigint, track?: Track) {
    this.seed = seed;
    this.track = track ?? buildTrack(seed);
    this.platHp = this.track.plats.map((p) => (p.crumble ? -2 : -1));
    this._score = 0;
  }

  get snapshot(): WorldSnapshot {
    const broken: number[] = [];
    for (let i = 0; i < this.platHp.length; i++) {
      if (this.platHp[i] === 0) broken.push(i);
    }
    return {
      tick: this.tick,
      x: this._x,
      y: this._y,
      vy: this._vy,
      grounded: this._grounded,
      alive: this._alive,
      finished: this._finished,
      score: this._score,
      timeMs: Math.round((this.tick * 1000) / TICK_RATE),
      distanceM: Math.floor(this._x / 25),
      coinCount: this._coinsGot,
      crumblesBroken: broken,
    };
  }

  takeEvents(): SimEvent[] {
    if (this.evq.length === 0) return [];
    const out = this.evq.slice();
    this.evq.length = 0;
    return out;
  }

  /** 深拷贝世界状态（track 只读共享；coins 的 got 标记共享但不影响物理确定性）。
   *  用途：AI 决策 / 提示系统 / 服务端批量重放。 */
  clone(): World {
    const c = Object.create(World.prototype) as World;
    c.seed = this.seed;
    c.track = this.track;
    c.tick = this.tick;
    c._x = this._x;
    c._y = this._y;
    c._vy = this._vy;
    c._grounded = this._grounded;
    c._alive = this._alive;
    c._finished = this._finished;
    c._coinsGot = this._coinsGot;
    c._score = this._score;
    c.coyote = this.coyote;
    c.buffer = this.buffer;
    c.holding = this.holding;
    c.holdTicks = this.holdTicks;
    c.platHp = this.platHp.slice();
    c.evq = [];
    return c;
  }

  /** 推进一个逻辑 tick。input 为该 tick 的输入位掩码字节。 */
  step(input: number): void {
    if (!this._alive || this._finished) return;
    this.tick++;

    // ---- 碎裂板倒计时（触发后持续计时，离开也不暂停）----
    for (let i = 0; i < this.platHp.length; i++) {
      const hp = this.platHp[i]!;
      if (hp > 0) {
        const left = hp - 1;
        this.platHp[i] = left;
        if (left === 0) this.evq.push({ type: 'crumble', index: i });
      }
    }

    // ---- 输入缓冲 ----
    if ((input & IN_JUMP_PRESS) !== 0) this.buffer = BUFFER_TICKS;
    // ---- 起跳判定（含土狼时间）----
    if (this.buffer > 0 && (this._grounded || this.coyote > 0)) {
      this._vy = -TUNING.jumpV;
      this._grounded = false;
      this.holding = true;
      this.holdTicks = 0;
      this.buffer = 0;
      this.coyote = 0;
      this.evq.push({ type: 'jump' });
    } else if (this.buffer > 0) {
      this.buffer--;
    }

    const half = PLAYER_R * 0.6;
    const x = this._x;

    if (this._grounded) {
      this._vy = 0;
      // 走下边缘检测
      if (!this.hasSupportAt(x, half)) {
        this._grounded = false;
        this.coyote = COYOTE_TICKS;
      }
    }
    if (!this._grounded) {
      let g = TUNING.grav;
      if (this.holding) {
        if ((input & IN_JUMP_HELD) !== 0 && this.holdTicks < HOLD_MAX_TICKS) {
          g *= TUNING.holdGravFactor;
          this.holdTicks++;
        } else {
          this.holding = false;
        }
      }
      const prevFeet = this._y + PLAYER_R;
      this._vy += g * STEP_S;
      this._y += this._vy * STEP_S;
      const feet = this._y + PLAYER_R;
      if (this._vy >= 0) {
        const top = this.landingTopAt(x, half, prevFeet, feet);
        if (top !== null) {
          this._y = top - PLAYER_R;
          this._vy = 0;
          this._grounded = true;
          this.evq.push({ type: 'land' });
        }
      }
    }

    // ---- 前进 ----
    this._x += TUNING.vx * STEP_S;

    // ---- 弹跳菇：地面接触即弹射（含本 tick 落在菇上的情况）----
    if (this._grounded) {
      for (const pad of this.track.pads) {
        if (this._x + half > pad.x && this._x - half < pad.x + pad.w) {
          this._vy = -bounceV;
          this._grounded = false;
          this.holding = false;
          this.evq.push({ type: 'bounce' });
          break;
        }
      }
    }

    // 计时
    const timeMs = Math.round((this.tick * 1000) / TICK_RATE);

    // ---- 金币 ----
    const coins = this.track.coins;
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i]!;
      if (c.got) continue;
      if (
        Math.abs(c.x - this._x) < PLAYER_R + 11 &&
        Math.abs(c.y - this._y) < PLAYER_R + 11
      ) {
        c.got = true;
        this._coinsGot++;
        this.evq.push({ type: 'coin', index: i });
      }
    }

    // ---- 尖刺（圆 vs AABB；按 x 排序可早退）----
    for (const hz of this.track.hazards) {
      if (hz.x > this._x + 64) break;
      if (
        circleHitsRect(this._x, this._y, PLAYER_R * 0.8, hz.x, hz.y, hz.w, hz.h)
      ) {
        this.die('spike');
        return;
      }
    }

    // ---- 坠坑 ----
    if (this._y - PLAYER_R > PIT_Y) {
      this.die('pit');
      return;
    }

    // ---- 终点 / 计分 ----
    if (!this._finished && this._x >= this.track.finishX) {
      this._finished = true;
      this._score = FINISH_BASE_SCORE - timeMs;
      this.evq.push({ type: 'finish' });
      return;
    }
    this._score = Math.floor(this._x / 25) * 100 + this._coinsGot * 50;
  }

  private die(cause: 'spike' | 'pit'): void {
    this._alive = false;
    this.evq.push({ type: 'crash', cause });
  }

  /** 站立支撑检测：脚下 2px 内存在平台顶且水平重叠。
   *  首次站上碎裂板会触发其倒计时；已碎裂的板不再提供支撑。 */
  private hasSupportAt(x: number, half: number): boolean {
    const feet = this._y + PLAYER_R;
    for (const s of this.track.grounds) {
      if (x + half < s.x0 || x - half > s.x1) continue;
      if (Math.abs(feet - GROUND_Y) <= 2) return true;
    }
    for (let i = 0; i < this.track.plats.length; i++) {
      const p = this.track.plats[i]!;
      if (p.crumble && this.platHp[i] === 0) continue; // 已碎
      if (x + half < p.x || x - half > p.x + p.w) continue;
      if (Math.abs(feet - p.y) <= 2) {
        if (p.crumble && this.platHp[i] === -2) this.platHp[i] = CRUMBLE_TICKS;
        return true;
      }
    }
    return false;
  }

  /** 下落着陆检测：prevFeet 在顶之上、新 feet 穿过顶面（跳过已碎裂的板） */
  private landingTopAt(
    x: number,
    half: number,
    prevFeet: number,
    feet: number,
  ): number | null {
    let best: number | null = null;
    for (const s of this.track.grounds) {
      if (x + half < s.x0 || x - half > s.x1) continue;
      if (prevFeet <= GROUND_Y + 1 && feet >= GROUND_Y) {
        best = best === null ? GROUND_Y : Math.min(best, GROUND_Y);
      }
    }
    for (let i = 0; i < this.track.plats.length; i++) {
      const p = this.track.plats[i]!;
      if (p.crumble && this.platHp[i] === 0) continue;
      if (x + half < p.x || x - half > p.x + p.w) continue;
      if (prevFeet <= p.y + 1 && feet >= p.y) {
        best = best === null ? p.y : Math.min(best, p.y);
      }
    }
    return best;
  }
}

export function createWorld(seed: bigint): World {
  return new World(seed);
}

/** 用自定义赛道创建世界（测试 / 关卡工具 / 未来玩法变体） */
export function createWorldWithTrack(seed: bigint, track: Track): World {
  return new World(seed, track);
}
