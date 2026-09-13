/**
 * 种子关卡生成 —— 手工积木 × 确定性随机。
 * 同一 seed 永远生成同一条赛道（全球每日同图的基础）。
 */
import {
  mix2,
  rngInt,
  rngPickWeighted,
  rngRange,
  splitmix32,
  type Rng,
} from '@dashline/shared';
import {
  PLAYER_R,
  PENDULUM_R,
  RAMP_MIN_STEP_W,
  RAMP_STEP_PX,
  UPDRAFT_G_FACTOR,
  boostRange,
  bounceHeight,
  bounceRange,
  gapWidthForTier,
  holdJumpHeight,
  holdJumpRange,
  tapJumpHeight,
  type MoverDef,
  type PendulumDef,
  type GateDef,
  type PortalDef,
  type ShieldDef,
  type MagnetDef,
} from './tuning.js';

/** 确定性的抛物线拱形，避免三角函数造成跨引擎逐位差异。 */
function arch01(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return 4 * u * (1 - u);
}

export type { GateDef, PortalDef, ShieldDef, MagnetDef } from './tuning.js';

/** 世界常量（渲染层也从这里取） */
export const GROUND_Y = 460; // 地面顶部 y（基准高度）
export const PIT_Y = 720; // 掉出此深度判死
export const CEILING_Y = 80; // 天花板倒挂基准 y
export const TARGET_LEN = 36000; // 目标赛道长度 px（约 100s）
export const SPIKE_W = 34;
export const SPIKE_H = 26;

/** 地形起伏上限：相对 GROUND_Y 最多抬高多少 px（保证画面与坑深逻辑不被破坏） */
export const TERRAIN_UP_MAX = 120;
/** 地形起伏下限：相对 GROUND_Y 最多下沉多少 px */
export const TERRAIN_DOWN_MAX = 40;
/** 坡顶后到第一个障碍的最小距离：保证玩家翻过坡顶后有反应时间 */
export const SPIKE_MIN_LEAD = 150;

export interface GroundSeg {
  x0: number;
  x1: number;
  /** 地面顶部 y；基准为 GROUND_Y，坡道由 ≤GROUND_STEP_MAX 的台阶拼成 */
  y: number;
}
export interface Hazard {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Coin {
  x: number;
  y: number;
  got: boolean;
}
export interface Plat {
  x: number;
  y: number;
  w: number;
  /** 碎裂板：踩上后 CRUMBLE_TICKS 内碎裂 */
  crumble?: boolean;
  /** 升降平台：顶面 y 按 tick 三角波在 [y-amp, y+amp] 往返 */
  mover?: MoverDef;
  /** 倒挂支撑板（重力反转时在上方支撑） */
  inverted?: boolean;
}
/** 弹跳菇：贴在地面上的弹射区 */
export interface Pad {
  x: number;
  w: number;
}
/** 加速带：地面区间，踩上获得限时 vx 增益 */
export interface BoostZone {
  x: number;
  w: number;
}
/** 二段跳环：空中拾取后获得一次额外空中跳 */
export interface Ring {
  x: number;
  y: number;
  got: boolean;
}
/** 气流柱：矩形区域，位于其中时重力 ×factor（飞出柱顶恢复正常重力） */
export interface WindZone {
  x: number;
  w: number;
  /** 柱高（自地面向上），顶 = GROUND_Y - h */
  h: number;
  factor: number;
}

export interface Track {
  grounds: GroundSeg[];
  hazards: Hazard[];
  coins: Coin[];
  plats: Plat[];
  pads: Pad[];
  boosts: BoostZone[];
  rings: Ring[];
  winds: WindZone[];
  pendulums: PendulumDef[];
  gates: GateDef[];
  portals: PortalDef[];
  shields: ShieldDef[];
  magnets: MagnetDef[];
  finishX: number;
  length: number;
}

/** 赛道拼装器：维护地面连续段、当前地面高度与游标 */
class Builder {
  cursor = 0;
  private segStart = -400; // 起点前留一段，绝不出生长在坑上
  /** 当前地面段的顶面 y；ramp 会逐级改变它 */
  private segY = GROUND_Y;
  grounds: GroundSeg[] = [];
  hazards: Hazard[] = [];
  coins: Coin[] = [];
  plats: Plat[] = [];
  pads: Pad[] = [];
  boosts: BoostZone[] = [];
  rings: Ring[] = [];
  winds: WindZone[] = [];
  pendulums: PendulumDef[] = [];
  gates: GateDef[] = [];
  portals: PortalDef[] = [];
  shields: ShieldDef[] = [];
  magnets: MagnetDef[] = [];

  run(dx: number): void {
    this.cursor += dx;
  }

  /** 收束当前地面段（长度为 0 时不产生空段） */
  private flush(): void {
    if (this.cursor > this.segStart) {
      this.grounds.push({ x0: this.segStart, x1: this.cursor, y: this.segY });
    }
  }

  /** 挖一个宽 w 的坑（断开当前地面段）；坑对岸保持同一高度 */
  gap(w: number): void {
    this.flush();
    this.cursor += w;
    this.segStart = this.cursor;
  }

  /**
   * 阶梯坡道：把总落差 dy 拆成若干 ≤RAMP_STEP_PX 的台阶。
   * 玩家靠 GROUND_STEP_MAX 的贴地容差自动上下坡，因此不需要斜坡碰撞，
   * 视觉上也是像素游戏常见的"阶梯山丘"。
   */
  ramp(dx: number, dy: number): void {
    const steps = Math.max(1, Math.ceil(Math.abs(dy) / RAMP_STEP_PX));
    const stepDx = dx / steps;
    const stepDy = dy / steps;
    let y = this.segY;
    for (let i = 0; i < steps; i++) {
      // 顺序很重要：先用"当前高度"收束刚走过的一段，再抬高/降低进入下一段。
      // 反过来会把整段路记成新高度，等于地面提前一步变化。
      this.cursor += stepDx;
      this.flush();
      y += stepDy;
      this.segY = Math.round(y);
      this.segStart = this.cursor;
    }
  }

  /**
   * 坡道到绝对高度 targetY。
   * 地形积木一律用这个而不是 ramp(相对量)：相对量在多次调用之间会累积，
   * 一旦某块忘记抵消就会把地面越推越高/越挖越深。
   * dx 不足时自动放慢坡度，保证每级台阶至少有 RAMP_MIN_STEP_W 宽。
   */
  rampTo(dx: number, targetY: number): void {
    const dy = targetY - this.segY;
    if (Math.abs(dy) < 1) {
      this.run(dx);
      return;
    }
    const steps = Math.ceil(Math.abs(dy) / RAMP_STEP_PX);
    const need = steps * RAMP_MIN_STEP_W;
    this.ramp(Math.max(dx, need), dy);
  }

  /** 当前地面段顶面 y（供积木把刺/金币等贴在正确高度） */
  groundTop(): number {
    return this.segY;
  }

  close(): void {
    this.flush();
  }
}

// -------------------------------------------------------------
// 积木库：每个函数在 b 上追加一段赛道，并把 cursor 前移
// -------------------------------------------------------------

function chFlat(b: Builder, r: Rng): void {
  const len = rngRange(r, 420, 720);
  const coinCnt = rngInt(r, 1, 4);
  const step = len / (coinCnt + 1);
  for (let i = 1; i <= coinCnt; i++) {
    b.coins.push({
      x: b.cursor + i * step,
      y: GROUND_Y - rngRange(r, 28, 48),
      got: false,
    });
  }
  b.run(len);
}

function chGap(b: Builder, r: Rng, tier: number): void {
  b.run(rngRange(r, 140, 240));
  const w = gapWidthForTier(tier, r);
  const coinX = b.cursor + w / 2;
  const coinY = GROUND_Y - tapJumpHeight * (0.6 + tier * 0.2);
  b.coins.push({ x: coinX, y: coinY, got: false });
  b.gap(w);
  b.run(rngRange(r, 160, 260));
}

function chSpike(b: Builder, r: Rng, tier: number): void {
  b.run(rngRange(r, 160, 240));
  const cnt = tier === 0 ? 1 : tier === 1 ? 2 : rngInt(r, 2, 3);
  const w = cnt * SPIKE_W;
  b.hazards.push({ x: b.cursor, y: GROUND_Y - SPIKE_H, w, h: SPIKE_H });
  const arcH = holdJumpHeight * (0.45 + tier * 0.18);
  b.coins.push({ x: b.cursor + w / 2, y: GROUND_Y - arcH, got: false });
  b.cursor += w;
  b.run(rngRange(r, 160, 240));
}

function chStairs(b: Builder, r: Rng): void {
  b.run(rngRange(r, 140, 200));
  const steps = rngInt(r, 2, 3);
  const pw = 120;
  const ph = 52;
  const dx = 130;
  const pitW = (steps + 1) * dx;
  const startX = b.cursor;
  b.gap(pitW);
  for (let i = 0; i < steps; i++) {
    const px = startX + (i + 0.5) * dx - pw / 2;
    const py = GROUND_Y - (i + 1) * ph;
    b.plats.push({ x: px, y: py, w: pw });
    b.coins.push({ x: px + pw / 2, y: py - 36, got: false });
  }
  b.run(rngRange(r, 160, 240));
}

function chBonus(b: Builder, r: Rng): void {
  b.run(rngRange(r, 120, 180));
  const w = gapWidthForTier(0, r);
  b.hazards.push({ x: b.cursor, y: GROUND_Y - SPIKE_H, w, h: SPIKE_H });
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1);
    const cx = b.cursor + t * w;
    const cy = GROUND_Y - arch01(t) * (holdJumpHeight * 0.92);
    b.coins.push({ x: cx, y: cy, got: false });
  }
  b.cursor += w;
  b.run(rngRange(r, 120, 180));
}

function chPadPit(b: Builder, r: Rng): void {
  b.run(rngRange(r, 130, 200));
  const padW = 48;
  const padX = b.cursor;
  b.pads.push({ x: padX, w: padW });
  b.cursor += padW;
  const pitW = bounceRange * rngRange(r, 0.72, 0.88);
  const islandW = 100;
  const sideGap = (pitW - islandW) / 2;
  b.gap(sideGap);
  const islandX0 = b.cursor;
  b.run(islandW);
  b.coins.push(
    { x: islandX0 + islandW / 2, y: GROUND_Y - Math.min(240, bounceHeight * 0.8), got: false },
    { x: islandX0 + islandW / 2 + bounceRange * 0.45, y: GROUND_Y - 110, got: false },
  );
  b.gap(sideGap);
  b.run(rngRange(r, 130, 200));
}

function chLowBar(b: Builder, r: Rng): void {
  b.run(rngRange(r, 160, 260));
  const spikeCnt = rngInt(r, 1, 2);
  const sw = spikeCnt * SPIKE_W;
  const sx = b.cursor;
  b.hazards.push({ x: sx, y: GROUND_Y - SPIKE_H, w: sw, h: SPIKE_H });
  const barBottom = GROUND_Y - (tapJumpHeight + PLAYER_R * 0.8 + 44);
  const barW = sw + 150;
  b.hazards.push({ x: sx - 75, y: barBottom - SPIKE_H, w: barW, h: SPIKE_H });
  b.coins.push({ x: sx + sw / 2, y: GROUND_Y - tapJumpHeight * 0.72, got: false });
  b.cursor += sw;
  b.run(rngRange(r, 130, 190));
}

function chCrumble(b: Builder, r: Rng): void {
  b.run(rngRange(r, 130, 210));
  const plankW = 115;
  const plankGap = 75;
  const n = 3;
  const total = n * plankW + (n - 1) * plankGap;
  const pitX = b.cursor;
  b.gap(total + 30);
  for (let i = 0; i < n; i++) {
    const px = pitX + 15 + i * (plankW + plankGap);
    const py = GROUND_Y - 24;
    b.plats.push({ x: px, y: py, w: plankW, crumble: true });
    b.coins.push({ x: px + plankW / 2, y: py - 36, got: false });
  }
  b.run(rngRange(r, 140, 220));
}

function chElevator(b: Builder, r: Rng): void {
  b.run(rngRange(r, 140, 220));
  const pw = 130;
  const pitW = 340;
  const pitX = b.cursor;
  b.gap(pitW);
  const mover: MoverDef = {
    amp: 44,
    periodTicks: rngInt(r, 80, 120),
    phase: rngInt(r, 0, 120),
  };
  const platX = pitX + (pitW - pw) / 2;
  const basePy = GROUND_Y - 60;
  b.plats.push({ x: platX, y: basePy, w: pw, mover });
  b.coins.push(
    { x: platX + pw / 2, y: basePy - mover.amp - 36, got: false },
    { x: platX + pw / 2, y: basePy + mover.amp - 36, got: false },
  );
  b.run(rngRange(r, 150, 230));
}

function chBoost(b: Builder, r: Rng): void {
  b.run(rngRange(r, 130, 200));
  const bw = 170;
  b.boosts.push({ x: b.cursor, w: bw });
  b.cursor += bw;
  b.run(rngRange(r, 100, 160));
  const pitW = boostRange * rngRange(r, 0.62, 0.76);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1);
    const cx = b.cursor + t * pitW;
    const cy = GROUND_Y - arch01(t) * (holdJumpHeight * 1.35);
    b.coins.push({ x: cx, y: cy, got: false });
  }
  b.gap(pitW);
  b.run(rngRange(r, 160, 240));
}

function chRing(b: Builder, r: Rng): void {
  b.run(rngRange(r, 130, 200));
  const pitW = holdJumpRange * 1.45;
  const startX = b.cursor;
  b.gap(pitW);
  const ringX = startX + holdJumpRange * 0.72;
  const ringY = GROUND_Y - holdJumpHeight * 0.55;
  b.rings.push({ x: ringX, y: ringY, got: false });
  b.coins.push(
    { x: ringX, y: ringY, got: false },
    { x: ringX + 130, y: ringY - 55, got: false },
    { x: ringX + 260, y: ringY, got: false },
  );
  b.run(rngRange(r, 150, 220));
}

function chUpdraft(b: Builder, r: Rng): void {
  b.run(rngRange(r, 130, 200));
  const pitW = 440;
  const pitX = b.cursor;
  b.gap(pitW);
  const wzX = pitX + 40;
  const wzW = 180;
  const wzH = 260;
  b.winds.push({
    x: wzX,
    w: wzW,
    h: wzH,
    factor: UPDRAFT_G_FACTOR,
  });
  const shelfX = wzX + wzW + 20;
  const shelfW = 80;
  const shelfY = GROUND_Y - 45;
  b.plats.push({ x: shelfX, y: shelfY, w: shelfW });
  for (let i = 0; i < 4; i++) {
    b.coins.push({
      x: wzX + 25 + i * 40,
      y: GROUND_Y - 70 - i * 42,
      got: false,
    });
  }
  b.run(rngRange(r, 150, 220));
}

function chPendulum(b: Builder, r: Rng): void {
  b.run(rngRange(r, 140, 220));
  const span = 220;
  const px0 = b.cursor + 40;
  const px1 = px0 + span;
  const pd: PendulumDef = {
    x0: px0,
    x1: px1,
    highY: GROUND_Y - 85,
    lowY: GROUND_Y - 24,
    r: PENDULUM_R,
    periodTicks: rngInt(r, 90, 130),
    phase: rngInt(r, 0, 130),
  };
  b.pendulums.push(pd);
  b.coins.push(
    { x: px0 + span * 0.25, y: GROUND_Y - 45, got: false },
    { x: (px0 + px1) / 2, y: GROUND_Y - 45, got: false },
    { x: px0 + span * 0.75, y: GROUND_Y - 45, got: false },
  );
  b.run(span + 140);
  b.run(rngRange(r, 130, 200));
}

function chGate(b: Builder, r: Rng): void {
  b.run(rngRange(r, 150, 230));
  const gateX = b.cursor + 60;
  const gateW = 24;
  const gateH = 135;
  const g: GateDef = {
    x: gateX,
    y: GROUND_Y - gateH,
    w: gateW,
    h: gateH,
    periodTicks: rngInt(r, 110, 150),
    activeTicks: 55,
    phase: rngInt(r, 0, 150),
  };
  b.gates.push(g);
  b.coins.push({ x: gateX + gateW / 2, y: GROUND_Y - 40, got: false });
  b.run(160);
  b.run(rngRange(r, 120, 180));
}

function chCrumbleStairs(b: Builder, r: Rng): void {
  b.run(rngRange(r, 130, 200));
  const plankW = 118;
  const gapX = 78;
  const n = 3;
  const tailDrop = 130;
  const total = n * plankW + (n - 1) * gapX + tailDrop;
  const pitX = b.cursor;
  b.gap(total);
  const ys = [64, 128, 192];
  for (let i = 0; i < n; i++) {
    const px = pitX + i * (plankW + gapX);
    const py = GROUND_Y - ys[i]!;
    b.plats.push({ x: px, y: py, w: plankW, crumble: true });
    b.coins.push({ x: px + plankW / 2, y: py - 40, got: false });
  }
  b.run(rngRange(r, 140, 200));
}

/** 重力反转门：穿过入口门颠倒重力飞上天花板，在上方避开深渊，再穿过出口门回落地面 */
function chGravityPortal(b: Builder, r: Rng): void {
  b.run(rngRange(r, 140, 200));
  const inX = b.cursor + 40;
  b.portals.push({
    x: inX,
    y: GROUND_Y - 95,
    w: 36,
    h: 95,
    targetGravDir: -1,
  });
  b.run(80);

  const spanW = 580;
  const pitX = b.cursor;
  b.gap(spanW); // 地面是无法跨越的深渊

  // 天花板悬空跑道
  const ceilPlatW = 520;
  b.plats.push({
    x: pitX + 30,
    y: CEILING_Y + PLAYER_R,
    w: ceilPlatW,
    inverted: true,
  });

  // 天花板上的金币列
  for (let i = 0; i < 5; i++) {
    b.coins.push({
      x: pitX + 80 + i * 85,
      y: CEILING_Y + 42,
      got: false,
    });
  }

  // 出口门（将重力翻转回地面）
  const outX = pitX + ceilPlatW - 10;
  b.portals.push({
    x: outX,
    y: CEILING_Y,
    w: 36,
    h: 95,
    targetGravDir: 1,
  });

  b.run(rngRange(r, 160, 240));
}

/** 护盾之星挑战：拾取护盾星，获得 1 层无敌抵扣 */
function chShieldChallenge(b: Builder, r: Rng): void {
  b.run(rngRange(r, 140, 200));
  b.shields.push({
    x: b.cursor + 40,
    y: GROUND_Y - 60,
    got: false,
  });
  b.run(140);

  // 放置密集地刺与高额金币犒赏
  const sw = 2 * SPIKE_W;
  b.hazards.push({ x: b.cursor, y: GROUND_Y - SPIKE_H, w: sw, h: SPIKE_H });
  b.coins.push(
    { x: b.cursor + sw / 2, y: GROUND_Y - 95, got: false },
    { x: b.cursor + sw / 2 + 50, y: GROUND_Y - 95, got: false },
  );
  b.cursor += sw;
  b.run(rngRange(r, 150, 220));
}

/** 磁力宝石狂欢：拾取磁铁后，大范围宝石彩虹拱门被自动吸附 */
function chMagnetRun(b: Builder, r: Rng): void {
  b.run(rngRange(r, 140, 200));
  b.magnets.push({
    x: b.cursor + 40,
    y: GROUND_Y - 50,
    got: false,
  });
  b.run(120);

  // 彩虹弧度金币阵（玩家无需跳跃也能被磁铁吸附）
  const span = 420;
  for (let i = 0; i < 7; i++) {
    const t = (i + 1) / 8;
    const cx = b.cursor + t * span;
    const cy = GROUND_Y - 65 - arch01(t) * 110;
    b.coins.push({ x: cx, y: cy, got: false });
  }
  b.run(span);
  b.run(rngRange(r, 140, 200));
}

type ChunkName =
  | 'flat'
  | 'gap0'
  | 'gap1'
  | 'gap2'
  | 'spike0'
  | 'spike1'
  | 'spike2'
  | 'stairs'
  | 'bonus'
  | 'padpit'
  | 'lowbar'
  | 'crumble'
  | 'elevator'
  | 'boost'
  | 'ring'
  | 'updraft'
  | 'pendulum'
  | 'crumblestairs'
  | 'gate'
  | 'gravityportal'
  | 'shield'
  | 'magnet'
  | 'hill'
  | 'valley'
  | 'mesa'
  | 'rolling';

// -------------------------------------------------------------
// 地形积木（第五批）：高低地面。
// 约定：每个地形块结束前必须 ramp 回基准高度 GROUND_Y，
// 这样其余积木可以继续假定"地面在 GROUND_Y"，不必逐个适配。
// -------------------------------------------------------------

/** 山丘：上坡 → 平台顶 → 下坡，顶上有刺或金币奖励 */
function chHill(b: Builder, r: Rng): void {
  b.run(rngRange(r, 140, 200));
  const upW = rngRange(r, 220, 320);
  const topW = rngRange(r, 180, 300);
  const peak = rngRange(r, 60, TERRAIN_UP_MAX);
  b.rampTo(upW, GROUND_Y - peak);
  const topY = b.groundTop();
  // 丘顶金币拱
  const n = 4;
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1);
    b.coins.push({ x: b.cursor + t * topW, y: topY - 34 - arch01(t) * 46, got: false });
  }
  // 半数山丘在丘顶放一道刺，逼玩家控制上下坡节奏。
  // 位置至少离丘顶起点 SPIKE_MIN_LEAD 远：玩家刚翻过坡顶就被刺扎到不公平。
  if (r() < 0.5) {
    const sx = b.cursor + Math.max(SPIKE_MIN_LEAD, topW * rngRange(r, 0.45, 0.7));
    if (sx < b.cursor + topW - SPIKE_W) {
      b.hazards.push({ x: sx, y: topY - SPIKE_H, w: SPIKE_W, h: SPIKE_H });
    }
  }
  b.run(topW);
  b.rampTo(upW * rngRange(r, 0.85, 1.15), GROUND_Y);
  b.run(rngRange(r, 120, 180));
}

/** 谷地：下沉 → 谷底 → 爬升，谷底放弹跳菇或金币 */
function chValley(b: Builder, r: Rng): void {
  b.run(rngRange(r, 130, 190));
  const downW = rngRange(r, 200, 300);
  const floorW = rngRange(r, 180, 300);
  const depth = rngRange(r, 26, TERRAIN_DOWN_MAX);
  b.rampTo(downW, GROUND_Y + depth);
  const floorY = b.groundTop();
  for (let i = 0; i < 3; i++) {
    b.coins.push({ x: b.cursor + ((i + 1) / 4) * floorW, y: floorY - 40, got: false });
  }
  if (r() < 0.45) {
    b.pads.push({ x: b.cursor + floorW * 0.4, w: 48 });
  }
  b.run(floorW);
  b.rampTo(downW * rngRange(r, 0.85, 1.15), GROUND_Y);
  b.run(rngRange(r, 120, 180));
}

/** 高台：抬升到高处跑一段，末端降回；高台边缘有落差，需要跳下 */
function chMesa(b: Builder, r: Rng): void {
  b.run(rngRange(r, 140, 200));
  const upW = rngRange(r, 200, 280);
  const topW = rngRange(r, 300, 520);
  const rise = rngRange(r, 70, TERRAIN_UP_MAX);
  b.rampTo(upW, GROUND_Y - rise);
  const topY = b.groundTop();
  const coinCnt = rngInt(r, 2, 5);
  const step = topW / (coinCnt + 1);
  for (let i = 1; i <= coinCnt; i++) {
    b.coins.push({ x: b.cursor + i * step, y: topY - rngRange(r, 30, 52), got: false });
  }
  b.run(topW);
  // 高台末端下降：用台阶而不是悬崖，避免"必须精准跳跃"的强制失败点
  b.rampTo(upW * rngRange(r, 0.6, 0.9), GROUND_Y);
  b.run(rngRange(r, 130, 190));
}

/** 连绵起伏：连续两三个波峰波谷，纯地形变化不给障碍 */
function chRolling(b: Builder, r: Rng): void {
  b.run(rngRange(r, 120, 180));
  const waves = rngInt(r, 2, 3);
  for (let i = 0; i < waves; i++) {
    const w = rngRange(r, 200, 300);
    const amp = rngRange(r, 34, 92);
    // 每波都以绝对高度为目标：上/下交替但始终夹在 [GROUND_Y-TERRAIN_UP_MAX, GROUND_Y+TERRAIN_DOWN_MAX] 内
    const up = i % 2 === 0;
    b.rampTo(w, up ? GROUND_Y - amp : GROUND_Y + Math.min(amp, TERRAIN_DOWN_MAX));
    const y = b.groundTop();
    b.coins.push({ x: b.cursor + w * 0.5, y: y - 42, got: false });
    b.run(w);
  }
  b.rampTo(rngRange(r, 220, 320), GROUND_Y);
  b.run(rngRange(r, 120, 180));
}

function pickChunk(b: Builder, r: Rng): void {
  // 基础池：起步就能见到的积木，地形块从一开局就参与（让前 15 秒就有起伏）
  const names: ChunkName[] = ['flat', 'gap0', 'spike0', 'stairs', 'bonus', 'hill', 'valley'];
  const weights = [2, 2, 3, 2, 2, 3, 2];
  // 解锁门槛用"绝对距离"而不是赛道百分比：赛道拉长后，百分比门槛会把
  // 有趣的积木推到很后面（原来 0.55 在 19000px 时约 29s，在 36000px 时
  // 会变成 55s），等于整条赛道有一半是新手区。这里改用 px 保持"秒数"不变。
  const x = b.cursor;
  if (x >= 2400) {
    names.push('gap1', 'spike1', 'lowbar', 'shield', 'magnet');
    weights.push(2, 3, 3, 1, 1);
  }
  if (x >= 5000) {
    names.push('padpit', 'crumble', 'elevator', 'updraft', 'gravityportal');
    weights.push(2, 2, 2, 2, 2);
  }
  if (x >= 7600) {
    names.push('crumblestairs', 'gate', 'mesa', 'rolling');
    weights.push(2, 2, 3, 2);
  }
  if (x >= 10400) {
    names.push('gap2', 'spike2', 'boost', 'ring', 'pendulum');
    weights.push(2, 3, 2, 2, 2);
  }
  const name = names[rngPickWeighted(r, weights)]!;
  switch (name) {
    case 'flat':
      return chFlat(b, r);
    case 'gap0':
      return chGap(b, r, 0);
    case 'gap1':
      return chGap(b, r, 1);
    case 'gap2':
      return chGap(b, r, 2);
    case 'spike0':
      return chSpike(b, r, 0);
    case 'spike1':
      return chSpike(b, r, 1);
    case 'spike2':
      return chSpike(b, r, 2);
    case 'stairs':
      return chStairs(b, r);
    case 'bonus':
      return chBonus(b, r);
    case 'padpit':
      return chPadPit(b, r);
    case 'lowbar':
      return chLowBar(b, r);
    case 'crumble':
      return chCrumble(b, r);
    case 'elevator':
      return chElevator(b, r);
    case 'boost':
      return chBoost(b, r);
    case 'ring':
      return chRing(b, r);
    case 'updraft':
      return chUpdraft(b, r);
    case 'pendulum':
      return chPendulum(b, r);
    case 'crumblestairs':
      return chCrumbleStairs(b, r);
    case 'gate':
      return chGate(b, r);
    case 'gravityportal':
      return chGravityPortal(b, r);
    case 'shield':
      return chShieldChallenge(b, r);
    case 'magnet':
      return chMagnetRun(b, r);
    case 'hill':
      return chHill(b, r);
    case 'valley':
      return chValley(b, r);
    case 'mesa':
      return chMesa(b, r);
    case 'rolling':
      return chRolling(b, r);
  }
}

export function buildTrack(seed: bigint): Track {
  const r = splitmix32(mix2(Number(seed & 0xffffffffn), Number(seed >> 32n)));
  const b = new Builder();
  chFlat(b, r);
  chFlat(b, r); // 起步热身：必为平地
  while (b.cursor < TARGET_LEN) pickChunk(b, r);
  const finishX = b.cursor;
  b.run(480); // 终点前缓冲跑道
  b.close();
  return {
    grounds: b.grounds,
    hazards: b.hazards.sort((a, z) => a.x - z.x),
    coins: b.coins,
    plats: b.plats.sort((a, z) => a.x - z.x),
    pads: b.pads.sort((a, z) => a.x - z.x),
    boosts: b.boosts.sort((a, z) => a.x - z.x),
    rings: b.rings.sort((a, z) => a.x - z.x),
    winds: b.winds.sort((a, z) => a.x - z.x),
    pendulums: b.pendulums.sort((a, z) => a.x0 - z.x0),
    gates: b.gates.sort((a, z) => a.x - z.x),
    portals: b.portals.sort((a, z) => a.x - z.x),
    shields: b.shields.sort((a, z) => a.x - z.x),
    magnets: b.magnets.sort((a, z) => a.x - z.x),
    finishX,
    length: b.cursor,
  };
}
