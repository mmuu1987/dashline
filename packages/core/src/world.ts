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
import { GROUND_Y, PIT_Y, buildTrack, type Plat, type Track, type WindZone, type GateDef } from './chunks.js';

export { GROUND_Y, PIT_Y } from './chunks.js';
export type { Track, GroundSeg, Hazard, Coin, Plat, Pad, GateDef } from './chunks.js';
export { PLAYER_R, CRUMBLE_TICKS, bounceV, PENDULUM_R, isGateActive } from './tuning.js';
export { TUNING, tapJumpHeight, holdJumpHeight, pendulumBob } from './tuning.js';

import { PLAYER_R, TUNING, CRUMBLE_TICKS, bounceV, BOOST_FACTOR, BOOST_TICKS, djumpV, moverOffsetY, UPDRAFT_G_FACTOR, PENDULUM_R, pendulumBob, isGateActive } from './tuning.js';

export const START_X = 80;
export const START_Y = GROUND_Y - PLAYER_R;

export type SimEvent =
  | { type: 'jump' }
  | { type: 'land' }
  | { type: 'coin'; index: number }
  | { type: 'crash'; cause: 'spike' | 'pit' | 'ball' | 'laser' }
  | { type: 'bounce' }
  | { type: 'crumble'; index: number }
  | { type: 'ring'; index: number }
  | { type: 'djump' }
  | { type: 'boost' }
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
  /** 已拾取的二段跳环下标（渲染层据此隐藏） */
  ringsGot: readonly number[];
  /** 加速剩余比例 0~1（>0 时渲染金色拖尾） */
  boost: number;
  /** 当前可用的空中二段跳次数（0~2） */
  airJumps: number;
  /** 蓄力进度 0~1（长按上升段），0 = 未在蓄力。渲染层画蓄力环用 */
  charge: number;
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
  private _airJumps = 0;
  private _boostLeft = 0;
  /** 动态收集态全部收敛到 world 内部账本（track 对象保持只读共享，杜绝 clone 污染） */
  private _coinsGotIdx = new Set<number>();
  private _ringsGotIdx = new Set<number>();
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
    const ringsGotArr: number[] = [];
    for (const i of this._ringsGotIdx) ringsGotArr.push(i);
    ringsGotArr.sort((a, b) => a - b);
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
      ringsGot: ringsGotArr,
      boost: this._boostLeft > 0 ? this._boostLeft / BOOST_TICKS : 0,
      airJumps: this._airJumps,
      charge: !this._grounded && this.holding ? Math.min(1, this.holdTicks / HOLD_MAX_TICKS) : 0,
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
    c._airJumps = this._airJumps;
    c._boostLeft = this._boostLeft;
    c._coinsGotIdx = new Set(this._coinsGotIdx);
    c._ringsGotIdx = new Set(this._ringsGotIdx);
    c.evq = [];
    return c;
  }

  /** 推进一个逻辑 tick。input 为该 tick 的输入位掩码字节。 */
  step(input: number): void {
    if (!this._alive || this._finished) return;
    this.tick++;
    if (this._boostLeft > 0) this._boostLeft--;
    // 土狼时间逐 tick 衰减（修复：此前从未递减，导致离边后无限期可起跳、
    // 空中误触满血跳、二段跳环分支永不生效 —— core.5 回归根因）
    if (!this._grounded && this.coyote > 0) this.coyote--;

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
    } else if (
      (input & IN_JUMP_PRESS) !== 0 &&
      !this._grounded &&
      this.coyote <= 0 &&
      this._airJumps > 0
    ) {
      // ---- 空中二段跳（环授予；不占用地面预输入缓冲）----
      this._vy = -djumpV;
      this._airJumps--;
      this.holding = true;
      this.holdTicks = 0;
      this.evq.push({ type: 'djump' });
    } else if (this.buffer > 0) {
      this.buffer--;
    }

    const half = PLAYER_R * 0.6;
    const x = this._x;

    if (this._grounded) {
      this._vy = 0;
      this._airJumps = 0; // 任意落地/站台都重置空中跳
      // 升降平台随行：先吸附到本 tick 台面再判走下边缘
      const mv = this.moverUnder(x, half);
      if (mv !== null) {
        this._y = this.moverTop(mv, this.tick) - PLAYER_R;
      } else if (!this.hasSupportAt(x, half)) {
        this._grounded = false;
        this.coyote = COYOTE_TICKS;
      }
    }
    if (!this._grounded) {
      // 气流柱：处于柱体区间（中心在柱顶以下）时减重；飞出柱顶恢复常重力
      let windF = 1;
      for (const wz of this.track.winds) {
        if (x + half <= wz.x || x - half >= wz.x + wz.w) continue;
        if (this._y >= GROUND_Y - wz.h) {
          windF = Math.min(windF, wz.factor);
        }
      }
      let g = TUNING.grav * (windF < 1 ? windF : 1);
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

    // ---- 前进（加速带增益期间提速）----
    this._x += (this._boostLeft > 0 ? TUNING.vx * BOOST_FACTOR : TUNING.vx) * STEP_S;

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

    // ---- 加速带：站台接触即触发（一次性，直到耗尽再踩才重触发）----
    if (this._grounded && this._boostLeft <= 0) {
      for (const z of this.track.boosts) {
        if (this._x + half > z.x && this._x - half < z.x + z.w) {
          this._boostLeft = BOOST_TICKS;
          this.evq.push({ type: 'boost' });
          break;
        }
      }
    }

    // 计时
    const timeMs = Math.round((this.tick * 1000) / TICK_RATE);

    // ---- 金币 ----
    const coins = this.track.coins;
    for (let i = 0; i < coins.length; i++) {
      if (this._coinsGotIdx.has(i)) continue;
      const c = coins[i]!;
      if (
        Math.abs(c.x - this._x) < PLAYER_R + 11 &&
        Math.abs(c.y - this._y) < PLAYER_R + 11
      ) {
        this._coinsGotIdx.add(i);
        this._coinsGot++;
        this.evq.push({ type: 'coin', index: i });
      }
    }

    // ---- 二段跳环 ----
    const rings = this.track.rings;
    for (let i = 0; i < rings.length; i++) {
      if (this._ringsGotIdx.has(i)) continue;
      const rg = rings[i]!;
      if (
        Math.abs(rg.x - this._x) < PLAYER_R + 16 &&
        Math.abs(rg.y - this._y) < PLAYER_R + 16
      ) {
        this._ringsGotIdx.add(i);
        this._airJumps = Math.min(2, this._airJumps + 1);
        this.evq.push({ type: 'ring', index: i });
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

    // ---- 横扫钉球（圆 vs 圆；摆位是 tick 的纯函数）----
    for (const pd of this.track.pendulums) {
      const bob = pendulumBob(pd, this.tick);
      if (Math.abs(bob.x - this._x) > pd.r + PLAYER_R + 8) continue;
      const dx = bob.x - this._x;
      const dy = bob.y - this._y;
      const rr = pd.r + PLAYER_R * 0.8;
      if (dx * dx + dy * dy < rr * rr) {
        this.die('ball');
        return;
      }
    }

    // ---- 激光闸门（圆 vs AABB；仅在危险通电激活时致死）----
    if (this.track.gates) {
      for (const gt of this.track.gates) {
        if (gt.x > this._x + 64) break;
        if (this._x + PLAYER_R < gt.x) continue;
        if (isGateActive(gt, this.tick)) {
          if (circleHitsRect(this._x, this._y, PLAYER_R * 0.8, gt.x, gt.y, gt.w, gt.h)) {
            this.die('laser');
            return;
          }
        }
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

  private die(cause: 'spike' | 'pit' | 'ball' | 'laser'): void {
    this._alive = false;
    this.evq.push({ type: 'crash', cause });
  }

  /** 平台本 tick 的顶面 y（升降台按三角波偏移） */
  private moverTop(p: Plat, tick: number): number {
    return p.mover ? p.y + moverOffsetY(p.mover, tick) : p.y;
  }

  /** 脚下正踩着的升降台（吸附随行用） */
  private moverUnder(x: number, half: number): Plat | null {
    const feet = this._y + PLAYER_R;
    for (const p of this.track.plats) {
      if (!p.mover) continue;
      if (x + half < p.x || x - half > p.x + p.w) continue;
      if (Math.abs(feet - this.moverTop(p, this.tick)) <= 2) return p;
    }
    return null;
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
      const py = this.moverTop(p, this.tick);
      if (Math.abs(feet - py) <= 2) {
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
      // 升降台：上一 tick 与本 tick 的台面都参与判定（追上抬升中的台面）
      const pyPrev = this.moverTop(p, this.tick - 1);
      const pyCur = this.moverTop(p, this.tick);
      if (prevFeet <= pyPrev + 1 && feet >= pyCur) {
        best = best === null ? pyCur : Math.min(best, pyCur);
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
