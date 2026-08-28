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
} from './tuning.js';

export type { GateDef } from './tuning.js';

/** 世界常量（渲染层也从这里取） */
export const GROUND_Y = 460; // 地面顶部 y
export const PIT_Y = 720; // 掉出此深度判死
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

  run(dx: number): void {
    this.cursor += dx;
  }

  /** 挖一个宽 w 的坑（断开当前地面段） */
  gap(w: number): void {
    this.grounds.push({ x0: this.segStart, x1: this.cursor });
    this.cursor += w;
    this.segStart = this.cursor;
  }

  close(): void {
    this.grounds.push({ x0: this.segStart, x1: this.cursor });
  }
}

function coinRow(b: Builder, r: Rng, y: number, n: number, gapPx = 80, pad = 50): void {
  for (let i = 0; i < n; i++) {
    b.coins.push({ x: b.cursor + pad + i * gapPx, y, got: false });
  }
}

/** 平地：偶尔摆一排贴地金币 */
function chFlat(b: Builder, r: Rng): void {
  const w = rngRange(r, 300, 560);
  if (r() < 0.55) coinRow(b, r, GROUND_Y - 52, rngInt(r, 3, 5));
  b.run(w);
}

/** 坑：宽度按难度分档（= 长按跳距离的比例，见 tuning.ts）；坑上摆三金币弧线指示跳跃路径 */
function chGap(b: Builder, r: Rng, tier: number): void {
  b.run(rngRange(r, 70, 150));
  const gw = gapWidthForTier(tier, r);
  const gx = b.cursor;
  const apexY = GROUND_Y - rngRange(r, 95, 135);
  b.coins.push(
    { x: gx + gw / 2 - 46, y: GROUND_Y - 72, got: false },
    { x: gx + gw / 2, y: apexY, got: false },
    { x: gx + gw / 2 + 46, y: GROUND_Y - 72, got: false },
  );
  b.gap(gw);
  b.run(rngRange(r, 90, 170));
}

/** 尖刺簇：1~3 连刺，高风险位偶尔悬金币 */
function chSpike(b: Builder, r: Rng, tier: number): void {
  const clusters = tier === 0 ? rngInt(r, 1, 2) : rngInt(r, 2, 3);
  for (let c = 0; c < clusters; c++) {
    b.run(rngRange(r, 150, 260));
    const cnt = rngInt(r, 1, Math.min(3, tier + 1));
    const w = cnt * SPIKE_W;
    b.hazards.push({ x: b.cursor, y: GROUND_Y - SPIKE_H, w, h: SPIKE_H });
    if (tier > 0 && r() < 0.4) {
      b.coins.push({ x: b.cursor + w / 2, y: GROUND_Y - 96, got: false });
    }
    b.run(w);
  }
}

/** 浮空台阶：地面安全路线 + 高处金币奖励（风险自选） */
function chStairs(b: Builder, r: Rng): void {
  const steps = rngInt(r, 3, 4);
  let px = b.cursor + rngRange(r, 60, 120);
  let py = GROUND_Y - 88;
  for (let i = 0; i < steps; i++) {
    const w = rngInt(r, 110, 150);
    b.plats.push({ x: px, y: py, w });
    b.coins.push({ x: px + w / 2, y: py - 38, got: false });
    px += w + rngRange(r, 60, 90);
    py = Math.max(GROUND_Y - 238, py - 56);
  }
  b.cursor = Math.max(b.cursor, px) + rngRange(r, 80, 140);
}

/** 奖励段：三连刺上方一道五币拱弧 */
function chBonus(b: Builder, r: Rng): void {
  b.run(rngRange(r, 120, 200));
  const w = SPIKE_W * 3;
  b.hazards.push({ x: b.cursor, y: GROUND_Y - SPIKE_H, w, h: SPIKE_H });
  const cx = b.cursor + w / 2;
  for (let i = -2; i <= 2; i++) {
    b.coins.push({ x: cx + i * 44, y: GROUND_Y - (104 + (2 - Math.abs(i)) * 24), got: false });
  }
  b.run(w);
}

/**
 * 弹跳菇大峡谷：超宽坑（两侧各 ~0.72 档坑宽可跳上中央菇岛），
 * 直接飞越在物理上不可能（总宽 > 长按跳距离），必须踩菇弹射过第二段。
 */
function chPadPit(b: Builder, r: Rng): void {
  b.run(rngRange(r, 140, 220));
  const sideGap = Math.round(holdJumpRange * rngRange(r, 0.62, 0.72)); // 边缘→菇岛：强蓄力可及
  const islandW = 160;
  b.gap(sideGap);
  // 菇岛是一段普通地面，中央放弹跳区
  const islandX0 = b.cursor;
  b.run(islandW);
  b.pads.push({ x: islandX0 + 20, w: islandW - 40 });
  b.coins.push(
    { x: islandX0 + islandW / 2, y: GROUND_Y - Math.min(240, bounceHeight * 0.8), got: false },
    { x: islandX0 + islandW / 2 + bounceRange * 0.45, y: GROUND_Y - 110, got: false },
  );
  b.gap(sideGap);
  b.run(rngRange(r, 130, 200));
}

/** 低空刺梁：头顶悬梁 + 地面刺簇 → 只允许"点按短跳"，长按必撞梁（克制无脑蓄力）。
 *  梁底高度按派生量取值：点按顶点擦不过线之上、长按顶点必撞之下。 */
function chLowBar(b: Builder, r: Rng): void {
  b.run(rngRange(r, 160, 260));
  const spikeCnt = rngInt(r, 1, 2);
  const sw = spikeCnt * SPIKE_W;
  const sx = b.cursor;
  b.hazards.push({ x: sx, y: GROUND_Y - SPIKE_H, w: sw, h: SPIKE_H }); // 地面刺
  // 悬梁：底面高度 = 点按跳顶点 + 碰撞半径 + 44px 安全缝
  // （点按/极短按从梁下穿过；中长按开始撞梁；满蓄力必撞）
  const barBottom = GROUND_Y - (tapJumpHeight + PLAYER_R * 0.8 + 44);
  const barW = sw + 150;
  b.hazards.push({ x: sx - 75, y: barBottom - SPIKE_H, w: barW, h: SPIKE_H });
  b.coins.push({ x: sx + sw / 2, y: GROUND_Y - tapJumpHeight * 0.72, got: false });
  b.cursor += sw;
  b.run(rngRange(r, 130, 190));
}

/** 碎裂桥：全坑铺三块碎裂板，踩上即开始倒计时 —— 保持节奏别停留。 */
function chCrumble(b: Builder, r: Rng): void {
  b.run(rngRange(r, 130, 210));
  const plankW = 115;
  const plankGap = 75;
  const n = 3;
  const total = n * plankW + (n - 1) * plankGap;
  const pitX = b.cursor;
  b.gap(total + 30); // 前后各留一点余量
  for (let i = 0; i < n; i++) {
    const px = pitX + 15 + i * (plankW + plankGap);
    b.plats.push({ x: px, y: GROUND_Y, w: plankW, crumble: true });
    b.coins.push({ x: px + plankW / 2, y: GROUND_Y - 46, got: false });
  }
  b.run(rngRange(r, 140, 200));
}

/** 升降电梯：刺毯上方一座三角波升降台 —— 乘坐稳过，或点按连跳硬闯（双路线）。 */
function chElevator(b: Builder, r: Rng): void {
  b.run(rngRange(r, 140, 220));
  const sw = SPIKE_W * rngInt(r, 6, 8); // 204~272px 刺毯
  const sx = b.cursor;
  b.hazards.push({ x: sx, y: GROUND_Y - SPIKE_H, w: sw, h: SPIKE_H });
  const mw = 150;
  // 低点 top=GROUND_Y-54（板底距刺尖 6px+），高点 top=GROUND_Y-114
  b.plats.push({
    x: sx + sw / 2 - mw / 2,
    y: GROUND_Y - 84,
    w: mw,
    mover: { amp: 30, periodTicks: 144, phase: Math.round(rngRange(r, 0, 143)) },
  });
  // 高处宝石：只有乘到高点再起跳才够得着
  b.coins.push(
    { x: sx + sw / 2 - 40, y: GROUND_Y - 176, got: false },
    { x: sx + sw / 2, y: GROUND_Y - 198, got: false },
    { x: sx + sw / 2 + 40, y: GROUND_Y - 176, got: false },
  );
  b.cursor += sw;
  b.run(rngRange(r, 140, 200));
}

/** 加速带冲刺：踩带提速 → 冲上超远坑（无加速在物理上不可能越过）。 */
function chBoost(b: Builder, r: Rng): void {
  b.run(rngRange(r, 150, 230));
  const zw = 130;
  b.boosts.push({ x: b.cursor, w: zw });
  b.run(zw);
  b.run(rngRange(r, 60, 100)); // 起跳助跑（加速仍在持续）
  const gw = Math.round(boostRange * rngRange(r, 0.78, 0.88)); // > 满蓄力射程
  const gx = b.cursor;
  const apexY = GROUND_Y - rngRange(r, 150, 190);
  b.coins.push(
    { x: gx + gw * 0.3, y: GROUND_Y - 90, got: false },
    { x: gx + gw * 0.55, y: apexY, got: false },
    { x: gx + gw * 0.8, y: GROUND_Y - 90, got: false },
  );
  b.gap(gw);
  b.run(rngRange(r, 120, 180));
}

/** 二段跳环：超宽坑（>满蓄力射程），沿低空坠落走廊铺"阶梯环带"
 *  （四枚、高度150→84、捕获窗两两衔接）—— 无论起跳早晚弧线必扫中一枚，
 *  拾取点已接近坠线、剩程极短，二段跳轻松登岸。 */
function chRing(b: Builder, r: Rng): void {
  b.run(rngRange(r, 150, 220));
  const W = Math.round(holdJumpRange * rngRange(r, 1.22, 1.38)); // 单跳必死
  const gx = b.cursor;
  b.gap(W);
  const hs = [150, 128, 106, 84]; // 距地高度（低位走廊）
  const fr = [0.5, 0.62, 0.74, 0.85];
  for (let i = 0; i < 4; i++) {
    b.rings.push({ x: gx + W * fr[i]!, y: GROUND_Y - hs[i]!, got: false });
  }
  b.coins.push({ x: gx + W * 0.93, y: GROUND_Y - 92, got: false });
  b.run(rngRange(r, 140, 200));
}

/** 上升气流柱：超宽坑上方整片减重区 —— 满蓄力一跃冲天，扶摇直上吃高空宝石；
 *  飞出柱顶即恢复正常重力抛物线落向对岸。 */
function chUpdraft(b: Builder, r: Rng): void {
  b.run(rngRange(r, 150, 220));
  // 1.15~1.28 倍射程，配合 80px 对岸平台，确保起跳与落点窗口充裕
  const W = Math.round(holdJumpRange * rngRange(r, 1.15, 1.28));
  const gx = b.cursor;
  b.gap(W - 80); // 对岸搁板：多给 80px 落点容错
  b.run(80);
  // 柱体覆盖全坑并向两侧各探出 50px
  const h = 240;
  b.winds.push({
    x: gx - 50,
    w: W + 100,
    h,
    factor: UPDRAFT_G_FACTOR,
  });
  // 高空宝石阶梯：贴着柱内攀升路线摆放
  b.coins.push(
    { x: gx + W * 0.25, y: GROUND_Y - 130, got: false },
    { x: gx + W * 0.5, y: GROUND_Y - 200, got: false },
    { x: gx + W * 0.72, y: GROUND_Y - 160, got: false },
  );
  b.run(rngRange(r, 140, 200));
}

/** 横扫钉球：铁链吊球沿走廊横扫、两端下沉封路 —— 掐准它抬升回中的窗口冲刺。 */
function chPendulum(b: Builder, r: Rng): void {
  b.run(rngRange(r, 160, 240));
  const CW = 230; // 走廊宽
  const startX = b.cursor;
  b.pendulums.push({
    x0: startX + 26,
    x1: startX + CW - 26,
    highY: GROUND_Y - 118,
    lowY: GROUND_Y - 36,
    r: PENDULUM_R,
    periodTicks: Math.round(rngRange(r, 150, 190)),
    phase: Math.round(rngRange(r, 0, 149)),
  });
  b.coins.push(
    { x: startX + CW * 0.32, y: GROUND_Y - 62, got: false },
    { x: startX + CW * 0.5, y: GROUND_Y - 70, got: false },
    { x: startX + CW * 0.68, y: GROUND_Y - 62, got: false },
  );
  b.run(CW);
  b.run(rngRange(r, 140, 200));
}

/** 激光闸门：地面垂直高能激光，周期性通电与关闭。
 *  掐准断电窗口冲刺穿过，或起跳飞跃顶端吃高空金币。 */
function chGate(b: Builder, r: Rng): void {
  b.run(rngRange(r, 150, 240));
  const gx = b.cursor;
  const gateH = 80;
  const period = Math.round(rngRange(r, 130, 170));
  const active = Math.round(period * rngRange(r, 0.42, 0.50));
  const phase = Math.round(rngRange(r, 0, period - 1));
  b.gates.push({
    x: gx + 40,
    y: GROUND_Y - gateH,
    w: 16,
    h: gateH,
    periodTicks: period,
    activeTicks: active,
    phase,
  });
  // 高处宝石（飞跃路线）与低处穿行宝石
  b.coins.push(
    { x: gx + 48, y: GROUND_Y - gateH - 35, got: false },
    { x: gx + 110, y: GROUND_Y - 48, got: false },
  );
  b.run(160);
  b.run(rngRange(r, 120, 180));
}

/** 碎裂天梯：三层碎裂板逐级攀升，踩板即倒计时 —— 一路小跳别回头，顶端高币犒赏节奏大师。 */
function chCrumbleStairs(b: Builder, r: Rng): void {
  b.run(rngRange(r, 130, 200));
  const plankW = 118;
  const gapX = 78;
  const n = 3;
  const tailDrop = 130; // 第三块板后到对岸的空隙
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
  | 'gate';

function pickChunk(b: Builder, r: Rng): void {
  const names: ChunkName[] = ['flat', 'flat', 'gap0', 'spike0', 'stairs'];
  const weights = [3, 3, 2, 2, 2];
  const p = b.cursor / TARGET_LEN;
  if (p >= 0.22) {
    names.push('gap1', 'spike1', 'stairs', 'bonus', 'lowbar');
    weights.push(2, 2, 2, 1, 2);
  }
  if (p >= 0.35) {
    names.push('padpit', 'crumble', 'elevator', 'updraft');
    weights.push(1, 2, 2, 2);
  }
  if (p >= 0.45) {
    names.push('crumblestairs', 'gate');
    weights.push(1, 2);
  }
  if (p >= 0.55) {
    names.push('gap2', 'spike2', 'boost', 'ring', 'pendulum');
    weights.push(2, 2, 2, 2, 2);
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
    finishX,
    length: b.cursor,
  };
}
