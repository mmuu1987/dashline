/**
 * ★ 手感调参中心 —— 所有物理常数与派生量的唯一来源。
 *
 * 设计原则：
 *  - 改 TUNING 即可整体调整手感；
 *  - chunks.ts 的难度表不写死像素值，而是按本文件派生出的跳跃能力"比例"取值，
 *    因此任何调参都自动保持可通行（CI 护栏测试锁定安全边际）。
 *
 * 派生公式（连续近似，离散 tick 积分误差 <1%，护栏已留余量）：
 *  点按跳高度 h_tap = v² / 2g
 *  点按跳滞空      = 2v/g          → 距离 = vx · 滞空
 *  长按跳分段：蓄力期(g·factor) + 余量期(g)，再自由落体
 */
import { HOLD_MAX_TICKS, STEP_S } from '@dashline/shared';

/** 玩家碰撞半径（渲染层也从此导入） */
export const PLAYER_R = 16;

/** ★★ 手感旋钮 ★★ */
export const TUNING = {
  /** 恒定前进速度 px/s */
  vx: 360,
  /** 起跳初速 px/s */
  jumpV: 820,
  /** 重力 px/s²（越大越"重"，越小越"飘"） */
  grav: 2150,
  /** 长按上升段重力系数：<1 跳更高；1 = 无长按差异 */
  holdGravFactor: 0.52,
  /** 弹跳菇弹射初速系数（相对 jumpV） */
  bounceFactor: 1.32,
} as const;

/** 碎裂板被踩后的存活 tick 数（~0.43s：正常节奏擦着碎裂通过，停留即塌） */
export const CRUMBLE_TICKS = 26;
/** 弹跳菇弹射初速与派生弹道 */
export const bounceV = TUNING.jumpV * TUNING.bounceFactor;
export const bounceHeight = (bounceV * bounceV) / (2 * TUNING.grav);
export const bounceAirTime = (2 * bounceV) / TUNING.grav;
export const bounceRange = TUNING.vx * bounceAirTime;

// ---------- 点按跳 ----------
export const tapJumpHeight = (TUNING.jumpV * TUNING.jumpV) / (2 * TUNING.grav);
export const tapAirTime = (2 * TUNING.jumpV) / TUNING.grav;
export const tapJumpRange = TUNING.vx * tapAirTime;// ---------- 长按跳（分段积分）----------
const g1 = TUNING.grav * TUNING.holdGravFactor;
const HOLD_T = HOLD_MAX_TICKS * STEP_S;
const tToApexAtG1 = TUNING.jumpV / g1;

let _holdHeight: number;
let _riseTime: number;
if (tToApexAtG1 <= HOLD_T) {
  // 整个上升段都在蓄力窗口内
  _riseTime = tToApexAtG1;
  _holdHeight = (TUNING.jumpV * _riseTime) / 2;
} else {
  const riseInHold = TUNING.jumpV * HOLD_T - 0.5 * g1 * HOLD_T * HOLD_T;
  const vLeft = TUNING.jumpV - g1 * HOLD_T; // 蓄力结束瞬间剩余上升速度
  _holdHeight = riseInHold + (vLeft * vLeft) / (2 * TUNING.grav);
  _riseTime = HOLD_T + vLeft / TUNING.grav;
}
const _fallTime = Math.sqrt((2 * _holdHeight) / TUNING.grav);

export const holdJumpHeight = _holdHeight;
export const holdAirTime = _riseTime + _fallTime;
export const holdJumpRange = TUNING.vx * holdAirTime;

// ---------- 落点宽容（与 world.ts 的支撑判定一致：±0.6R）----------
export const EDGE_FORGIVE = PLAYER_R * 0.6;
/** 越过宽为 gap 的坑实际需要的水平位移 */
export const effectiveGapNeed = (gap: number): number => gap - 2 * EDGE_FORGIVE;

// ---------- 坑宽度分档（占长按跳距离的比例）----------
export const GAP_TIERS = [
  [0.38, 0.54], // easy：点按也能过
  [0.54, 0.7], // medium：需要接近满点按
  [0.68, 0.85], // hard：必须长按，且留 15% 操作余量
] as const;

export function gapWidthForTier(tier: number, r: () => number): number {
  const [lo, hi] = GAP_TIERS[Math.min(tier, GAP_TIERS.length - 1)]!;
  return holdJumpRange * (lo + r() * (hi - lo));
}
