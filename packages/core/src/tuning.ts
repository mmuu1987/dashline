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
  jumpV: 760,
  /** 重力 px/s²（越大越"重"，越小越"飘"） */
  grav: 2150,
  /** 长按上升段重力系数：<1 跳更高；1 = 无长按差异（0.34 → 满蓄 ≈ 2.05× 点按高度） */
  holdGravFactor: 0.34,
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

// ---------- 新积木：加速带 ----------
/** 踩上加速带后的速度倍率与持续时间（tick）。持续须覆盖"带长+助跑+坑宽"全程 */
export const BOOST_FACTOR = 1.55;
export const BOOST_TICKS = 90;
export const boostVx = TUNING.vx * BOOST_FACTOR;
/** 全程加速下的理想满蓄力跳距（chBoost 坑宽的基准） */
export const boostRange = boostVx * holdAirTime;

// ---------- 新积木：二段跳环 ----------
/** 空中二段跳起跳初速系数（相对 jumpV） */
export const DJUMP_FACTOR = 0.94;
export const djumpV = TUNING.jumpV * DJUMP_FACTOR;
/** 二段跳纯点按的水平航程（不含长按延伸） */
export const djumpTapRange = TUNING.vx * ((2 * djumpV) / TUNING.grav);

// ---------- 新积木：升降平台 ----------
/** 升降平台运动定义。位置是 tick 的纯函数：只用四则运算与 abs，
 *  不用 Math.sin（ECMAScript 允许三角函数实现差异，会破坏跨引擎逐位一致）。 */
export interface MoverDef {
  /** 相对基准顶面 y 的振幅 px */
  amp: number;
  /** 往返周期 tick 数 */
  periodTicks: number;
  /** 相位偏移 tick（决定起始高度） */
  phase: number;
}
/** 三角波升降偏移：值域 [-amp, +amp]，u=0 在最低点，半个周期后到最高点 */
export function moverOffsetY(m: MoverDef, tick: number): number {
  const u =
    ((((tick + m.phase) % m.periodTicks) + m.periodTicks) % m.periodTicks) /
    m.periodTicks;
  const tri = 2 * Math.abs(2 * u - 1) - 1; // [-1,1] 三角波
  return m.amp * tri;
}

// ---------- 关卡摆放工具：满蓄力弧线采样 ----------
/** 与 world.ts 离散积分逐 tick 一致的满蓄力（一直按住）轨迹高度。
 *  dx：距起跳点水平位移；返回 feet 高于起跳面的 px 数；超出射程返回 null。 */
export function holdArcHeightAt(dx: number): number | null {
  if (dx < 0 || dx > holdJumpRange) return null;
  let h = 0; // up-positive 高度
  let v = TUNING.jumpV;
  let holdLeft = HOLD_MAX_TICKS;
  const dt = STEP_S;
  const totalTicks = Math.ceil(holdAirTime / dt) + 2;
  let prevX = 0;
  let prevH = 0;
  for (let t = 1; t <= totalTicks; t++) {
    const g = holdLeft > 0 ? TUNING.grav * TUNING.holdGravFactor : TUNING.grav;
    if (holdLeft > 0) holdLeft--;
    v -= g * dt;
    h += v * dt;
    const cx = t * TUNING.vx * dt;
    if (cx >= dx) {
      const f = (dx - prevX) / (cx - prevX);
      return prevH + (h - prevH) * f;
    }
    if (h < 0) return null; // 已落回起跳面
    prevX = cx;
    prevH = h;
  }
  return null;
}

// ---------- 新积木（第三批）：上升气流柱 / 横扫钉球 / 激光闸门 ----------
/** 气流柱内重力系数（<1 减重漂浮；飞出柱顶恢复正常重力） */
export const UPDRAFT_G_FACTOR = 0.40;
/** 钉球碰撞半径 */
export const PENDULUM_R = 17;
/** 钉球摆位：tick 的纯函数（三角波，不用三角函数保证跨引擎逐位一致）。
 *  两端下沉封路、中段抬升放行 —— 摆到中间的窗口是通行时机。 */
export interface PendulumDef {
  /** 扫掠左端 x（钉球中心到达的左端） */
  x0: number;
  /** 扫掠右端 x */
  x1: number;
  /** 中段高位 y（玩家可从下方通过） */
  highY: number;
  /** 端点低位 y（封路高度） */
  lowY: number;
  r: number;
  periodTicks: number;
  phase: number;
}
export function pendulumBob(
  p: PendulumDef,
  tick: number,
): { x: number; y: number } {
  const u =
    ((((tick + p.phase) % p.periodTicks) + p.periodTicks) % p.periodTicks) /
    p.periodTicks;
  const tri = 2 * Math.abs(2 * u - 1) - 1; // [-1,1]
  // 对称钟摆路径：两端都下沉封路（y=lowY），经过中段时抬升放行（y=highY）
  return {
    x: (p.x0 + p.x1) / 2 + ((p.x1 - p.x0) / 2) * tri,
    y: p.highY - (p.highY - p.lowY) * Math.abs(tri),
  };
}

/** 激光闸门定义：周期性通电的激光束。
 *  tick 的纯函数：只用整数取模，零三角函数，跨引擎逐位一致。
 *  通电中：触碰即死；断电中：安全通行。
 */
export interface GateDef {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 完整周期 tick 数 */
  periodTicks: number;
  /** 处于危险通电态的 tick 数 */
  activeTicks: number;
  /** 相位偏移 tick */
  phase: number;
}

export function isGateActive(g: GateDef, tick: number): boolean {
  const u = (((tick + g.phase) % g.periodTicks) + g.periodTicks) % g.periodTicks;
  return u < g.activeTicks;
}

// ---------- 新积木（第四批）：重力翻转门 / 护盾之星 / 磁力宝石 ----------
/** 重力翻转门定义：触碰后改变世界重力方向（1=正向地面，-1=天花板倒挂） */
export interface PortalDef {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 目标重力方向：1 为朝下（正常地面），-1 为朝上（天花板倒挂） */
  targetGravDir: 1 | -1;
}

/** 护盾道具定义：拾取后赋予主角 1 层致死碰撞保护 */
export interface ShieldDef {
  x: number;
  y: number;
  got: boolean;
}

/** 磁铁道具定义：拾取后一定时间内自动吸附大范围宝石 */
export interface MagnetDef {
  x: number;
  y: number;
  got: boolean;
}

export const MAGNET_DURATION_TICKS = 180; // 3 秒
export const MAGNET_RADIUS = 150; // 150px 吸附半径

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
