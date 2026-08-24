/**
 * 新积木护栏：弹跳菇 / 低空刺梁 / 碎裂板。
 * 用 createWorldWithTrack 构造最小确定性赛道，脚本化输入验证机制成立。
 */
import { describe, expect, it } from 'vitest';
import { makeInput } from '@dashline/shared';
import {
  CRUMBLE_TICKS,
  GROUND_Y,
  SPIKE_H,
  SPIKE_W,
  createWorldWithTrack,
  holdJumpRange,
  tapJumpHeight,
  type GroundSeg,
  type Hazard,
  type Pad,
  type Plat,
  type Track,
} from '../src/index.js';

/** 测试用迷你 Builder（与 core 内部 Builder 同语义） */
class TB {
  cursor = 0;
  private segStart = -100;
  grounds: GroundSeg[] = [];
  hazards: Hazard[] = [];
  coins: { x: number; y: number; got: boolean }[] = [];
  plats: Plat[] = [];
  pads: Pad[] = [];
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
  track(finishPad = 300): Track {
    const finishX = this.cursor;
    this.run(finishPad);
    this.close();
    return {
      grounds: this.grounds,
      hazards: this.hazards,
      coins: this.coins,
      plats: this.plats,
      pads: this.pads,
      boosts: [],
      rings: [],
      finishX,
      length: this.cursor,
    };
  }
}

interface RunResult {
  alive: boolean;
  finished: boolean;
  x: number;
  events: string[];
  brokenCount: number;
}

function run(track: Track, inputs: Uint8Array, maxTicks = 3600): RunResult {
  const w = createWorldWithTrack(1n, track);
  const events: string[] = [];
  for (let i = 0; i < inputs.length && i < maxTicks; i++) {
    w.step(inputs[i]!);
    for (const e of w.takeEvents()) events.push(e.type);
    if (!w.snapshot.alive || w.snapshot.finished) break;
  }
  return {
    alive: w.snapshot.alive,
    finished: w.snapshot.finished,
    x: w.snapshot.x,
    events,
    brokenCount: w.snapshot.crumblesBroken.length,
  };
}

function blank(ticks: number): Uint8Array {
  return new Uint8Array(ticks);
}
function jumpAt(inputs: Uint8Array, at: number, hold: number): void {
  inputs[at] = makeInput(true, true);
  for (let k = 1; k < hold; k++) inputs[at + k] = makeInput(false, true);
}

/* ---------------- 弹跳菇 ---------------- */

function padPitTrack(): { track: Track; pitStart: number; pitEnd: number } {
  const b = new TB();
  b.run(400);
  b.run(120); // 助跑段
  const pitStart = b.cursor;
  const sideGap = Math.round(holdJumpRange * 0.65);
  b.gap(sideGap);
  b.pads.push({ x: b.cursor + 20, w: 120 }); // 岛中央菇
  b.run(160);
  b.gap(sideGap);
  const pitEnd = b.cursor;
  b.run(500);
  return { track: b.track(), pitStart, pitEnd };
}

describe('积木：弹跳菇', () => {
  it('直接走进坑必死（大峡谷确有天堑）', () => {
    const { track, pitEnd } = padPitTrack();
    const r = run(track, blank(600));
    expect(r.alive).toBe(false);
    expect(r.x).toBeLessThan(pitEnd);
  });

  it('跳上菇岛 → 自动弹射 → 跨过第二段（事件含 bounce）', () => {
    const { track, pitStart, pitEnd } = padPitTrack();
    const inputs = blank(600);
    jumpAt(inputs, 0, 0); // no-op 保持结构
    // 在坑沿前 60px 起跳满蓄力
    const takeoff = Math.round(pitStart - 60) - 80; // 减去出生点偏移近似
    // 出生 x=80，tick i 时 x ≈ 80 + 6i；反推起跳 tick
    const t0 = Math.round((pitStart - 60 - 80) / 6);
    jumpAt(inputs, t0, 15);
    const r = run(track, inputs);
    expect(r.events).toContain('bounce');
    expect(r.alive).toBe(true);
    expect(r.x).toBeGreaterThan(pitEnd + 20);
  });
});

/* ---------------- 低空刺梁 ---------------- */

function lowBarTrack(): { track: Track; spikeX: number } {
  const b = new TB();
  b.run(300);
  const spikeX = b.cursor;
  const sw = SPIKE_W * 2;
  b.hazards.push({ x: spikeX, y: GROUND_Y - SPIKE_H, w: sw, h: SPIKE_H });
  const barBottom = GROUND_Y - (tapJumpHeight + 12.8 + 34);
  b.hazards.push({ x: spikeX - 75, y: barBottom - SPIKE_H, w: sw + 150, h: SPIKE_H });
  b.cursor += sw;
  b.run(420);
  return { track: b.track(), spikeX };
}

describe('积木：低空刺梁', () => {
  it('点按短跳可穿过（顶点擦梁而过）', () => {
    const { track, spikeX } = lowBarTrack();
    const t0 = Math.round((spikeX - 135 - 80) / 6);
    const inputs = blank(600);
    jumpAt(inputs, t0, 2); // 纯点按
    const r = run(track, inputs);
    expect(r.alive).toBe(true);
    expect(r.x).toBeGreaterThan(spikeX + 150);
  });

  it('长按蓄力撞梁必死（克制无脑长按）', () => {
    const { track, spikeX } = lowBarTrack();
    const t0 = Math.round((spikeX - 135 - 80) / 6);
    const inputs = blank(600);
    jumpAt(inputs, t0, 15); // 满蓄力
    const r = run(track, inputs);
    expect(r.alive).toBe(false);
  });
});

/* ---------------- 碎裂桥 ---------------- */

function crumbleBridgeTrack(): { track: Track; bridgeEnd: number } {
  const b = new TB();
  b.run(320);
  const plankW = 115;
  const n = 3;
  const total = n * plankW + (n - 1) * 75;
  const pitX = b.cursor;
  b.gap(total + 30);
  for (let i = 0; i < n; i++) {
    b.plats.push({ x: pitX + 15 + i * (plankW + 75), y: GROUND_Y, w: plankW, crumble: true });
  }
  const bridgeEnd = pitX + total + 30;
  b.run(420);
  return { track: b.track(), bridgeEnd };
}

describe('积木：碎裂板', () => {
  it('踩上后超时会碎、掉进桥下坑（停留惩罚）', () => {
    const { track } = crumbleBridgeTrack();
    // 跳上第一块板后不再起跳：滑行出板缘 → 落入板间坑
    const inputs = blank(900);
    // 第一块板起点约在 cursor 435+15=450；在坑沿前 50px 满蓄力起跳
    const pitEdge = 320 + 200; // 上面 run(320)+run(?) — 直接用探测式：尽早跳一次落在板上
    void pitEdge;
    // 找到第一块板的绝对位置：track.plats[0]
    const p0 = track.plats[0]!;
    const t0 = Math.round((p0.x - 60 - 80) / 6);
    jumpAt(inputs, Math.max(t0, 1), 15);
    const r = run(track, inputs, 1200);
    expect(r.alive).toBe(false); // 滑出碎板后坠坑
    expect(r.brokenCount).toBeGreaterThanOrEqual(1); // 板确实碎了
  });

  it('保持节奏三连跳可通过全桥（碎裂事件触发但不致命）', () => {
    const { track, bridgeEnd } = crumbleBridgeTrack();
    const p0 = track.plats[0]!;
    const plankW = 115;
    const hop = Math.round(plankW / 6); // 一块板的滑行 ticks
    const inputs = blank(900);
    let t = Math.max(Math.round((p0.x - 70 - 80) / 6), 1);
    jumpAt(inputs, t, 13);
    for (let i = 1; i < 3; i++) {
      t += hop + 10;
      jumpAt(inputs, t, 11);
    }
    const r = run(track, inputs, 1200);
    expect(r.alive).toBe(true);
    expect(r.x).toBeGreaterThan(bridgeEnd);
    expect(r.events).toContain('crumble');
  });

  it('倒计时常量给正常节奏留余量（一块板滑行 ticks < 存活 ticks）', () => {
    expect(115 / 6).toBeLessThan(CRUMBLE_TICKS * 1.05);
  });
});
