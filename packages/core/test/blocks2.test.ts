/**
 * 新积木护栏（第二轮）：加速带 / 二段跳环 / 升降平台。
 * 与 blocks.test.ts 同一套迷你 Builder + 脚本化输入方法。
 */
import { describe, expect, it } from 'vitest';
import { makeInput } from '@dashline/shared';
import {
  BOOST_TICKS,
  GROUND_Y,
  buildTrack,
  boostRange,
  createWorldWithTrack,
  holdArcHeightAt,
  holdJumpRange,
  moverOffsetY,
  type BoostZone,
  type GroundSeg,
  type Hazard,
  type Pad,
  type Plat,
  type Ring,
  type SimEvent,
  type Track,
} from '../src/index.js';

class TB {
  cursor = 0;
  private segStart = -100;
  grounds: GroundSeg[] = [];
  hazards: Hazard[] = [];
  coins: { x: number; y: number; got: boolean }[] = [];
  plats: Plat[] = [];
  pads: Pad[] = [];
  boosts: BoostZone[] = [];
  rings: Ring[] = [];
  run(dx: number): void {
    this.cursor += dx;
  }
  gap(w: number): void {
    this.grounds.push({ x0: this.segStart, x1: this.cursor });
    this.cursor += w;
    this.segStart = this.cursor;
  }
  close(): void {
    this.grounds.push({ x0: this.segStart, x1: this.cursor });
  }
  track(finishPad = 400): Track {
    const finishX = this.cursor;
    this.run(finishPad);
    this.close();
    return {
      grounds: this.grounds,
      hazards: this.hazards,
      coins: this.coins,
      plats: this.plats,
      pads: this.pads,
      boosts: this.boosts,
      rings: this.rings,
      finishX,
      length: this.cursor,
    };
  }
}

interface RunResult {
  alive: boolean;
  finished: boolean;
  x: number;
  events: SimEvent[];
}

function run(track: Track, inputs: Uint8Array, maxTicks = 3600): RunResult {
  const w = createWorldWithTrack(1n, track);
  const events: SimEvent[] = [];
  for (let i = 0; i < inputs.length && i < maxTicks; i++) {
    w.step(inputs[i]!);
    for (const e of w.takeEvents()) events.push(e);
    if (!w.snapshot.alive || w.snapshot.finished) break;
  }
  return { alive: w.snapshot.alive, finished: w.snapshot.finished, x: w.snapshot.x, events };
}

function blank(ticks: number): Uint8Array {
  return new Uint8Array(ticks);
}
function jumpAt(inputs: Uint8Array, at: number, hold: number): void {
  if (at < 0 || at >= inputs.length) return;
  inputs[at] = makeInput(true, true);
  for (let k = 1; k < hold; k++) inputs[at + k] = makeInput(false, true);
}

/* ---------------- 加速带 ---------------- */

function boostTrack(withZone: boolean): { track: Track; pitStart: number; pitEnd: number } {
  const b = new TB();
  b.run(420); // 出生段
  const zx = b.cursor; // 加速带起点
  if (withZone) b.boosts.push({ x: zx, w: 130 });
  b.run(130 + 80); // 带长 + 助跑
  const pitStart = b.cursor;
  const gw = Math.round(boostRange * 0.82);
  b.gap(gw);
  const pitEnd = b.cursor;
  b.run(500);
  return { track: b.track(), pitStart, pitEnd };
}

describe('积木：加速带', () => {
  it('无加速带时，满蓄力跳不过超宽坑（物理不可能）', () => {
    const { track, pitStart, pitEnd } = boostTrack(false);
    const inputs = blank(900);
    jumpAt(inputs, Math.round((pitStart - 20 - 80) / 6), 15);
    const r = run(track, inputs);
    expect(r.alive).toBe(false);
    expect(r.x).toBeLessThan(pitEnd);
  });

  it('踩带加速 → 满蓄力跳飞跃同一宽度的坑', () => {
    const { track, pitStart, pitEnd } = boostTrack(true);
    const inputs = blank(900);
    jumpAt(inputs, Math.round((pitStart - 20 - 80) / 6), 15);
    const r = run(track, inputs);
    expect(r.events.some((e) => e.type === 'boost')).toBe(true);
    expect(r.alive).toBe(true);
    expect(r.x).toBeGreaterThan(pitEnd + 30);
  });

  it('增益持续期有限（BOOST_TICKS 后快照归零）', () => {
    const b = new TB();
    b.run(300);
    b.boosts.push({ x: 300, w: 130 });
    b.run(1200);
    const w = createWorldWithTrack(1n, b.track());
    let sawBoost = false;
    for (let i = 0; i < 600; i++) {
      w.step(0);
      if (w.snapshot.boost > 0) sawBoost = true;
      if (i > 320 && w.snapshot.boost > 0 && i > 320 + BOOST_TICKS) {
        throw new Error('boost 超时未清零');
      }
    }
    expect(sawBoost).toBe(true);
  });
});

/* ---------------- 二段跳环 ---------------- */

function ringTrack(withRing: boolean): { track: Track; pitStart: number; pitEnd: number } {
  const b = new TB();
  b.run(420);
  const pitStart = b.cursor;
  const W = Math.round(holdJumpRange * 1.28);
  b.gap(W);
  const pitEnd = b.cursor;
  if (withRing) {
    const dxr = W * 0.52;
    // 与 chRing 同款：环贴在满蓄力弧线上（玩家中心高度）
    const arcH = holdArcHeightAt(dxr) ?? 150;
    b.rings.push({ x: pitStart + dxr, y: GROUND_Y - 16 - arcH, got: false });
  }
  b.run(500);
  return { track: b.track(), pitStart, pitEnd };
}

describe('积木：二段跳环', () => {
  it('单次满蓄力跳不过 1.28 倍坑（无环必死）', () => {
    const { track, pitEnd } = ringTrack(false);
    const inputs = blank(900);
    jumpAt(inputs, Math.round((420 - 20 - 80) / 6), 15);
    const r = run(track, inputs);
    expect(r.alive).toBe(false);
    expect(r.x).toBeLessThan(pitEnd);
  });

  it('空中拾环 → 二段跳接力过坑（ring+djump 事件齐备）', () => {
    const { track, pitEnd } = ringTrack(true);
    const ring = track.rings[0]!;
    const t0 = Math.round((420 - 20 - 80) / 6);
    // 空中跳时机：到达环 x 之后立刻（x ≈ 6tick/px）
    const tDj = t0 + Math.round((ring.x - 420) / 6) + 2;
    const inputs = blank(900);
    jumpAt(inputs, t0, 15);
    jumpAt(inputs, tDj, 12);
    const r = run(track, inputs);
    expect(r.events.some((e) => e.type === 'ring')).toBe(true);
    expect(r.events.some((e) => e.type === 'djump')).toBe(true);
    expect(r.alive).toBe(true);
    expect(r.x).toBeGreaterThan(pitEnd + 20);
  });

  it('二段跳一次性：空中连按两次只触发一次 djump', () => {
    const { track } = ringTrack(true);
    const ring = track.rings[0]!;
    const t0 = Math.round((420 - 20 - 80) / 6);
    const tDj = t0 + Math.round((ring.x - 420) / 6) + 2;
    const inputs = blank(900);
    jumpAt(inputs, t0, 15);
    jumpAt(inputs, tDj, 3);
    jumpAt(inputs, tDj + 8, 3); // 第二次空中按（已无次数）
    const r = run(track, inputs);
    expect(r.events.filter((e) => e.type === 'djump').length).toBe(1);
  });
});

/* ---------------- 升降平台 ---------------- */

function elevatorTrack(): { track: Track; plat: Plat } {
  const b = new TB();
  b.run(360);
  const px = b.cursor;
  const plat: Plat = {
    x: px,
    y: GROUND_Y - 84,
    w: 170,
    mover: { amp: 30, periodTicks: 144, phase: 36 },
  };
  b.plats.push(plat);
  b.run(700);
  return { track: b.track(), plat };
}

describe('积木：升降平台', () => {
  it('moverOffsetY 是 tick 的纯函数（同参同值，值域 ±amp）', () => {
    const m = { amp: 30, periodTicks: 144, phase: 36 };
    for (let t = 0; t < 500; t += 7) {
      expect(moverOffsetY(m, t)).toBe(moverOffsetY(m, t));
      expect(Math.abs(moverOffsetY(m, t))).toBeLessThanOrEqual(30 + 1e-9);
    }
  });

  it('落在升降台上可持续随行（贴合运动台面直到滑出边缘）', () => {
    const { track, plat } = elevatorTrack();
    // 满蓄力射程 ~348px：要落进 [360,530]，起跳点须在 [15,185] → t0 ∈ [0,17]
    let landed = false;
    for (let t0 = 2; t0 <= 24 && !landed; t0++) {
      const w = createWorldWithTrack(1n, track);
      const inputs = blank(400);
      jumpAt(inputs, t0, 15);
      let riding = false;
      let ok = false;
      for (let i = 0; i < inputs.length + 120; i++) {
        const inp = i < inputs.length ? inputs[i]! : 0;
        w.step(inp);
        w.takeEvents();
        const s = w.snapshot;
        if (!s.alive || s.finished) break;
        const top = plat.y + moverOffsetY(plat.mover!, w.tick);
        if (!riding) {
          // 登台判定：站台且脚贴合台面（地面脚=GROUND_Y，差 ≥50px 不会误判）
          if (s.grounded && s.x > plat.x + 6 && Math.abs(s.y + 16 - top) <= 3) {
            riding = true;
          }
        } else {
          if (s.x >= plat.x + plat.w - 14) {
            ok = true; // 平稳骑到头
            break;
          }
          if (!s.grounded || Math.abs(s.y + 16 - top) > 3) break;
        }
      }
      if (ok) landed = true;
    }
    expect(landed).toBe(true);
  });

  it('buildTrack 同 seed 逐位一致（含 mover 相位浮点）', () => {
    // 找一个同时包含三种新积木的种子
    let seed: bigint | null = null;
    for (let k = 1; k < 80; k++) {
      const tt = buildTrack(BigInt(k));
      if (
        tt.plats.some((p) => p.mover) &&
        tt.boosts.length > 0 &&
        tt.rings.length > 0
      ) {
        seed = BigInt(k);
        break;
      }
    }
    expect(seed).not.toBeNull();
    const a = JSON.stringify(buildTrack(seed!));
    const b2 = JSON.stringify(buildTrack(seed!));
    expect(a).toBe(b2);
    // 新积木确实出现在每日赛道池里
    const t = buildTrack(seed!);
    expect(t.plats.some((p) => p.mover)).toBe(true);
    expect(t.boosts.length).toBeGreaterThan(0);
    expect(t.rings.length).toBeGreaterThan(0);
  });
});
