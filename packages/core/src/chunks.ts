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

export type { GateDef, PortalDef, ShieldDef, MagnetDef } from './tuning.js';

/** 世界常量（渲染层也从这里取） */
export const GROUND_Y = 460; // 地面顶部 y
export const PIT_Y = 720; // 掉出此深度判死
export const CEILING_Y = 80; // 天花板倒挂基准 y
export const TARGET_LEN = 19000; // 目标赛道长度 px（约 53s）
export const SPIKE_W = 34;
export const SPIKE_H = 26;

export interface GroundSeg {
  x0: number;
  x1: number;
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

/** 赛道拼装器：维护地面连续段与游标 */
class Builder {
  cursor = 0;
  private segStart = -400; // 起点前留一段，绝不出生长在坑上
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

  /** 挖一个宽 w 的坑（断开当前地面段） */
  gap(w: number): void {
    if (this.cursor > this.segStart) {
      this.grounds.push({ x0: this.segStart, x1: this.cursor });
    }
    this.cursor += w;
    this.segStart = this.cursor;
  }

  close(): void {
    if (this.cursor > this.segStart) {
      this.grounds.push({ x0: this.segStart, x1: this.cursor });
    }
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
    const cy = GROUND_Y - Math.sin(t * Math.PI) * (holdJumpHeight * 0.92);
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
    const cy = GROUND_Y - Math.sin(t * Math.PI) * (holdJumpHeight * 1.35);
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
    const cy = GROUND_Y - 65 - Math.sin(t * Math.PI) * 110;
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
  | 'magnet';

function pickChunk(b: Builder, r: Rng): void {
  const names: ChunkName[] = ['flat', 'gap0', 'spike0', 'stairs', 'bonus'];
  const weights = [2, 2, 3, 2, 2];
  const p = b.cursor / TARGET_LEN;
  if (p >= 0.2) {
    names.push('gap1', 'spike1', 'lowbar', 'shield', 'magnet');
    weights.push(2, 3, 3, 1, 1);
  }
  if (p >= 0.35) {
    names.push('padpit', 'crumble', 'elevator', 'updraft', 'gravityportal');
    weights.push(2, 2, 2, 2, 2);
  }
  if (p >= 0.45) {
    names.push('crumblestairs', 'gate');
    weights.push(2, 2);
  }
  if (p >= 0.55) {
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
