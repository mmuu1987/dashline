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
  IN_JUMP_HELD,
  IN_JUMP_PRESS,
  STEP_S,
  TICK_RATE,
} from '@dashline/shared';
import {
  GROUND_Y,
  PIT_Y,
  CEILING_Y,
  buildTrack,
  type Plat,
  type Track,
  type WindZone,
  type GateDef,
  type PortalDef,
  type ShieldDef,
  type MagnetDef,
} from './chunks.js';

export { GROUND_Y, PIT_Y, CEILING_Y } from './chunks.js';
export type { Track, GroundSeg, Hazard, Coin, Plat, Pad, GateDef, PortalDef, ShieldDef, MagnetDef } from './chunks.js';
export { PLAYER_R, CRUMBLE_TICKS, bounceV, PENDULUM_R, isGateActive, MAGNET_DURATION_TICKS, MAGNET_RADIUS } from './tuning.js';
export { TUNING, tapJumpHeight, holdJumpHeight, pendulumBob } from './tuning.js';

import {
  PLAYER_R,
  TUNING,
  CRUMBLE_TICKS,
  bounceV,
  BOOST_FACTOR,
  BOOST_TICKS,
  djumpV,
  moverOffsetY,
  UPDRAFT_G_FACTOR,
  PENDULUM_R,
  pendulumBob,
  isGateActive,
  MAGNET_DURATION_TICKS,
  MAGNET_RADIUS,
} from './tuning.js';

export const START_X = 80;
export const START_Y = GROUND_Y - PLAYER_R;

export type SimEvent =
  | { type: 'jump' }
  | { type: 'land' }
  | { type: 'coin'; index: number; combo: number }
  | { type: 'crash'; cause: 'spike' | 'pit' | 'ball' | 'laser' }
  | { type: 'bounce' }
  | { type: 'crumble'; index: number }
  | { type: 'ring'; index: number }
  | { type: 'djump' }
  | { type: 'boost' }
  | { type: 'portal'; dir: 1 | -1 }
  | { type: 'shield' }
  | { type: 'shieldBreak' }
  | { type: 'magnet' }
  | { type: 'nearmiss'; x: number; y: number }
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
  /** 重力方向：1=正常地面，-1=天花板倒挂 */
  gravDir: 1 | -1;
  /** 是否拥有护盾 */
  hasShield: boolean;
  /** 磁铁剩余时间比例 0~1 */
  magnetLeft: number;
  /** 当前连击数 */
  combo: number;
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
  private _gravDir: 1 | -1 = 1;
  private _hasShield = false;
  private _shieldInvulTicks = 0;
  private _magnetTicks = 0;
  private _lastCoinTick = -999;
  private _coinCombo = 0;

  /** 动态收集态收敛到内部账本（track 对象只读共享） */
  private _coinsGotIdx = new Set<number>();
  private _ringsGotIdx = new Set<number>();
  private _shieldsGotIdx = new Set<number>();
  private _magnetsGotIdx = new Set<number>();
  private _nearMissHazards = new Set<number>();
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
      gravDir: this._gravDir,
      hasShield: this._hasShield,
      magnetLeft: this._magnetTicks > 0 ? this._magnetTicks / MAGNET_DURATION_TICKS : 0,
      combo: this._coinCombo,
    };
  }

  takeEvents(): SimEvent[] {
    if (this.evq.length === 0) return [];
    const out = this.evq.slice();
    this.evq.length = 0;
    return out;
  }

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
    c._gravDir = this._gravDir;
    c._hasShield = this._hasShield;
    c._shieldInvulTicks = this._shieldInvulTicks;
    c._magnetTicks = this._magnetTicks;
    c._lastCoinTick = this._lastCoinTick;
    c._coinCombo = this._coinCombo;
    c._coinsGotIdx = new Set(this._coinsGotIdx);
    c._ringsGotIdx = new Set(this._ringsGotIdx);
    c._shieldsGotIdx = new Set(this._shieldsGotIdx);
    c._magnetsGotIdx = new Set(this._magnetsGotIdx);
    c._nearMissHazards = new Set(this._nearMissHazards);
    c.evq = [];
    return c;
  }

  step(input: number): void {
    if (!this._alive || this._finished) return;
    this.tick++;
    if (this._boostLeft > 0) this._boostLeft--;
    if (this._shieldInvulTicks > 0) this._shieldInvulTicks--;
    if (this._magnetTicks > 0) this._magnetTicks--;
    if (this.tick - this._lastCoinTick > 48) this._coinCombo = 0; // ~0.8s 连击重置

    if (!this._grounded && this.coyote > 0) this.coyote--;

    // 碎裂板倒计时
    for (let i = 0; i < this.platHp.length; i++) {
      const hp = this.platHp[i]!;
      if (hp > 0) {
        const left = hp - 1;
        this.platHp[i] = left;
        if (left === 0) this.evq.push({ type: 'crumble', index: i });
      }
    }

    // 输入缓冲与起跳
    if ((input & IN_JUMP_PRESS) !== 0) this.buffer = BUFFER_TICKS;
    const jumpDir = -this._gravDir; // 正向重力向上跳 (vy<0)，反向重力向下跳 (vy>0)
    if (this.buffer > 0 && (this._grounded || this.coyote > 0)) {
      this._vy = jumpDir * TUNING.jumpV;
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
      this._vy = jumpDir * djumpV;
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
      this._airJumps = 0;
      const mv = this.moverUnder(x, half);
      if (mv !== null) {
        this._y = this.moverTop(mv, this.tick) - PLAYER_R * this._gravDir;
      } else if (!this.hasSupportAt(x, half)) {
        this._grounded = false;
        this.coyote = COYOTE_TICKS;
      }
    } else {
      // 空中重力积分
      let windF = 1;
      for (const wz of this.track.winds) {
        if (this._x >= wz.x && this._x <= wz.x + wz.w) {
          const top = GROUND_Y - wz.h;
          if (this._y >= top && this._y <= GROUND_Y) {
            windF = wz.factor;
            break;
          }
        }
      }
      let g = TUNING.grav * (windF < 1 ? windF : 1) * this._gravDir;
      if (this.holding) {
        if ((input & IN_JUMP_HELD) !== 0 && this.holdTicks < HOLD_MAX_TICKS) {
          g *= TUNING.holdGravFactor;
          this.holdTicks++;
        } else {
          this.holding = false;
        }
      }
      const prevFeet = this._y + PLAYER_R * this._gravDir;
      this._vy += g * STEP_S;
      this._y += this._vy * STEP_S;
      const feet = this._y + PLAYER_R * this._gravDir;

      // 落地判断
      if ((this._gravDir === 1 && this._vy >= 0) || (this._gravDir === -1 && this._vy <= 0)) {
        const top = this.landingTopAt(x, half, prevFeet, feet);
        if (top !== null) {
          this._y = top - PLAYER_R * this._gravDir;
          this._vy = 0;
          this._grounded = true;
          this.evq.push({ type: 'land' });
        }
      }
    }

    // 前进
    this._x += (this._boostLeft > 0 ? TUNING.vx * BOOST_FACTOR : TUNING.vx) * STEP_S;

    // 弹跳菇
    if (this._grounded && this._gravDir === 1) {
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

    // 加速带
    if (this._grounded && this._boostLeft <= 0) {
      for (const z of this.track.boosts) {
        if (this._x + half > z.x && this._x - half < z.x + z.w) {
          this._boostLeft = BOOST_TICKS;
          this.evq.push({ type: 'boost' });
          break;
        }
      }
    }

    // ---- 重力翻转门 ----
    if (this.track.portals) {
      for (const p of this.track.portals) {
        if (
          Math.abs(p.x + p.w / 2 - this._x) < p.w / 2 + PLAYER_R &&
          Math.abs(p.y + p.h / 2 - this._y) < p.h / 2 + PLAYER_R
        ) {
          if (this._gravDir !== p.targetGravDir) {
            this._gravDir = p.targetGravDir;
            this._vy = 0;
            this._grounded = false;
            this.holding = false;
            this.evq.push({ type: 'portal', dir: this._gravDir });
          }
        }
      }
    }

    // ---- 护盾道具 ----
    if (this.track.shields) {
      for (let i = 0; i < this.track.shields.length; i++) {
        if (this._shieldsGotIdx.has(i)) continue;
        const sh = this.track.shields[i]!;
        if (
          Math.abs(sh.x - this._x) < PLAYER_R + 18 &&
          Math.abs(sh.y - this._y) < PLAYER_R + 18
        ) {
          this._shieldsGotIdx.add(i);
          this._hasShield = true;
          this.evq.push({ type: 'shield' });
        }
      }
    }

    // ---- 磁铁道具 ----
    if (this.track.magnets) {
      for (let i = 0; i < this.track.magnets.length; i++) {
        if (this._magnetsGotIdx.has(i)) continue;
        const mg = this.track.magnets[i]!;
        if (
          Math.abs(mg.x - this._x) < PLAYER_R + 18 &&
          Math.abs(mg.y - this._y) < PLAYER_R + 18
        ) {
          this._magnetsGotIdx.add(i);
          this._magnetTicks = MAGNET_DURATION_TICKS;
          this.evq.push({ type: 'magnet' });
        }
      }
    }

    // ---- 金币（支持普通拾取 + 磁铁超大范围吸引）----
    const coins = this.track.coins;
    const isMagnet = this._magnetTicks > 0;
    const collectR = isMagnet ? MAGNET_RADIUS : PLAYER_R + 12;
    for (let i = 0; i < coins.length; i++) {
      if (this._coinsGotIdx.has(i)) continue;
      const c = coins[i]!;
      const dx = c.x - this._x;
      const dy = c.y - this._y;
      if (dx * dx + dy * dy < collectR * collectR) {
        this._coinsGotIdx.add(i);
        this._coinsGot++;
        this._coinCombo++;
        this._lastCoinTick = this.tick;
        this.evq.push({ type: 'coin', index: i, combo: this._coinCombo });
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

    // ---- 尖刺与极限擦刺判定（Near-Miss）----
    for (let i = 0; i < this.track.hazards.length; i++) {
      const hz = this.track.hazards[i]!;
      if (hz.x > this._x + 64) break;
      if (circleHitsRect(this._x, this._y, PLAYER_R * 0.8, hz.x, hz.y, hz.w, hz.h)) {
        this.die('spike');
        return;
      } else if (!this._nearMissHazards.has(i)) {
        // 极限擦刺（7px 间隙未碰）
        if (circleHitsRect(this._x, this._y, PLAYER_R + 7, hz.x, hz.y, hz.w, hz.h)) {
          this._nearMissHazards.add(i);
          this.evq.push({ type: 'nearmiss', x: this._x, y: this._y });
        }
      }
    }

    // ---- 横扫钉球 ----
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

    // ---- 激光闸门 ----
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

    // ---- 坠坑（正向掉出地面，反向飞出天花板）----
    if (this._gravDir === 1 && this._y - PLAYER_R > PIT_Y) {
      this.die('pit');
      return;
    } else if (this._gravDir === -1 && this._y + PLAYER_R < -100) {
      this.die('pit');
      return;
    }

    // ---- 终点 / 计分 ----
    const timeMs = Math.round((this.tick * 1000) / TICK_RATE);
    if (this._x >= this.track.finishX) {
      this._finished = true;
      this._score = Math.max(
        1,
        FINISH_BASE_SCORE - timeMs + this._coinsGot * 50_000,
      );
      this.evq.push({ type: 'finish' });
      return;
    }

    this._score = Math.floor(this._x * 10) + this._coinsGot * 500;
  }

  private die(cause: 'spike' | 'pit' | 'ball' | 'laser'): void {
    if (this._shieldInvulTicks > 0) return; // 护盾碎裂后短暂无敌
    if (this._hasShield && cause !== 'pit') {
      // 护盾抵扣致死伤害！
      this._hasShield = false;
      this._shieldInvulTicks = 22; // ~0.36s 保护无敌
      this.evq.push({ type: 'shieldBreak' });
      return;
    }
    this._alive = false;
    this.evq.push({ type: 'crash', cause });
  }

  private hasSupportAt(x: number, half: number): boolean {
    if (this._gravDir === 1) {
      for (const g of this.track.grounds) {
        if (x + half > g.x0 && x - half < g.x1) return true;
      }
    }
    for (let i = 0; i < this.track.plats.length; i++) {
      const p = this.track.plats[i]!;
      if (this.platHp[i] === 0) continue;
      if (p.inverted && this._gravDir !== -1) continue;
      if (!p.inverted && this._gravDir === -1) continue;
      if (x + half > p.x && x - half < p.x + p.w) {
        const top = p.mover ? this.moverTop(p, this.tick) : p.y;
        if (Math.abs(this._y + PLAYER_R * this._gravDir - top) < 4) return true;
      }
    }
    return false;
  }

  private moverUnder(x: number, half: number): Plat | null {
    for (let i = 0; i < this.track.plats.length; i++) {
      const p = this.track.plats[i]!;
      if (!p.mover) continue;
      if (this.platHp[i] === 0) continue;
      if (x + half > p.x && x - half < p.x + p.w) return p;
    }
    return null;
  }

  private moverTop(p: Plat, tick: number): number {
    return p.mover ? p.y + moverOffsetY(p.mover, tick) : p.y;
  }

  private landingTopAt(
    x: number,
    half: number,
    prevFeet: number,
    feet: number,
  ): number | null {
    let bestTop: number | null = null;
    if (this._gravDir === 1) {
      // 正向重力：地面
      for (const g of this.track.grounds) {
        if (x + half > g.x0 && x - half < g.x1) {
          if (prevFeet <= GROUND_Y && feet >= GROUND_Y) {
            bestTop = GROUND_Y;
          }
        }
      }
      // 平台
      for (let i = 0; i < this.track.plats.length; i++) {
        const p = this.track.plats[i]!;
        if (p.inverted) continue;
        if (this.platHp[i] === 0) continue;
        if (x + half > p.x && x - half < p.x + p.w) {
          const top = p.mover ? this.moverTop(p, this.tick) : p.y;
          if (prevFeet <= top && feet >= top) {
            if (bestTop === null || top < bestTop) {
              bestTop = top;
              if (p.crumble && this.platHp[i] === -2) {
                this.platHp[i] = CRUMBLE_TICKS;
              }
            }
          }
        }
      }
    } else {
      // 反向重力（天花板倒挂）
      for (let i = 0; i < this.track.plats.length; i++) {
        const p = this.track.plats[i]!;
        if (!p.inverted) continue;
        if (x + half > p.x && x - half < p.x + p.w) {
          const top = p.y;
          if (prevFeet >= top && feet <= top) {
            if (bestTop === null || top > bestTop) {
              bestTop = top;
            }
          }
        }
      }
    }
    return bestTop;
  }
}

export function createWorld(seed: bigint): World {
  return new World(seed);
}

export function createWorldWithTrack(seed: bigint, track: Track): World {
  return new World(seed, track);
}
