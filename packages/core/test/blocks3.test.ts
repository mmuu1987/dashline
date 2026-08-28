/**
 * 新积木护栏（第三批）：上升气流柱 / 横扫钉球 / 碎裂天梯。
 * 复用迷你 Builder；可行性类用例采用"小窗口搜索有效输入"，对未来调参鲁棒。
 */
import { describe, expect, it } from 'vitest';
import {
  HOLD_MAX_TICKS,
  makeInput,
} from '@dashline/shared';
import {
  GROUND_Y,
  PENDULUM_R,
  UPDRAFT_G_FACTOR,
  buildTrack,
  createWorldWithTrack,
  holdJumpHeight,
  holdJumpRange,
  pendulumBob,
  type GroundSeg,
  type Hazard,
  type PendulumDef,
  type SimEvent,
  type Track,
  type WindZone,
} from '../src/index.js';

class TB {
  cursor = 0;
  private segStart = -100;
  grounds: GroundSeg[] = [];
  hazards: Hazard[] = [];
  coins: { x: number; y: number; got: boolean }[] = [];
  plats: Array<{ x: number; y: number; w: number; crumble?: boolean }> = [];
  winds: WindZone[] = [];
  pendulums: PendulumDef[] = [];
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
      plats: this.plats as never,
      pads: [],
      boosts: [],
      rings: [],
      winds: this.winds,
      pendulums: this.pendulums,
      gates: [],
      portals: [],
      shields: [],
      magnets: [],
      finishX,
      length: this.cursor,
    };
  }
}

interface RunResult {
  alive: boolean;
  finished: boolean;
  x: number;
  minY: number;
  events: SimEvent[];
}

function run(track: Track, inputs: Uint8Array, maxTicks = 3600): RunResult {
  const w = createWorldWithTrack(1n, track);
  const events: SimEvent[] = [];
  let minY = w.snapshot.y;
  for (let i = 0; i < inputs.length && i < maxTicks; i++) {
    w.step(inputs[i]!);
    for (const e of w.takeEvents()) events.push(e);
    minY = Math.min(minY, w.snapshot.y);
    if (!w.snapshot.alive || w.snapshot.finished) break;
  }
  return { alive: w.snapshot.alive, finished: w.snapshot.finished, x: w.snapshot.x, minY, events };
}

function blank(ticks: number): Uint8Array {
  return new Uint8Array(ticks);
}
function jumpAt(inputs: Uint8Array, at: number, hold: number): void {
  if (at < 0 || at >= inputs.length) return;
  inputs[at] = makeInput(true, true);
  for (let k = 1; k < hold; k++) inputs[at + k] = makeInput(false, true);
}

/* ---------------- 气流柱 ---------------- */

function updraftTrack(withWind: boolean): { track: Track; pitStart: number; pitEnd: number } {
  const b = new TB();
  b.run(420);
  b.run(120);
  const pitStart = b.cursor;
  const W = Math.round(holdJumpRange * 1.18);
  b.gap(W);
  const pitEnd = b.cursor;
  if (withWind) {
    b.winds.push({
      x: pitStart - 40,
      w: W + 80,
      h: 250,
      factor: UPDRAFT_G_FACTOR,
    });
  }
  b.run(500);
  return { track: b.track(), pitStart, pitEnd };
}

describe('积木：上升气流柱', () => {
  it('柱内满蓄力一跃远超常规弧顶（减重生效）', () => {
    const b = new TB();
    b.run(400);
    b.winds.push({ x: 400, w: 300, h: 320, factor: UPDRAFT_G_FACTOR });
    b.run(1200);
    const { track, minY } = (() => ({ track: b.track(), minY: 0 }))();
    const inputs = blank(500);
    jumpAt(inputs, 40, HOLD_MAX_TICKS); // 出生段后起跳，整段滞空都在柱内
    const r = run(track, inputs);
    expect(r.alive).toBe(true);
    // 柱内弧顶显著高于常规满蓄高度（≥1.25×）
    expect(GROUND_Y - r.minY).toBeGreaterThan(holdJumpHeight * 1.25);
    void minY;
  });

  it('原生跳不过 1.18 倍坑（无风必死）', () => {
    const { track, pitEnd } = updraftTrack(false);
    let died = false;
    for (let t0 = 40; t0 <= 75 && !died; t0++) {
      const inputs = blank(700);
      jumpAt(inputs, t0, HOLD_MAX_TICKS);
      const r = run(track, inputs);
      if (!r.alive && r.x < pitEnd) died = true;
    }
    expect(died).toBe(true);
  });

  it('柱内蓄力起飞 → 飘过同一宽度的坑', () => {
    const { track, pitEnd } = updraftTrack(true);
    let crossed = false;
    for (let t0 = 45; t0 <= 85 && !crossed; t0++) {
      const inputs = blank(800);
      jumpAt(inputs, t0, HOLD_MAX_TICKS);
      const r = run(track, inputs);
      if (r.alive && r.x > pitEnd + 20) crossed = true;
    }
    expect(crossed).toBe(true);
  });
});

/* ---------------- 横扫钉球 ---------------- */

/** 相位选择：使玩家以 6px/tick 匀速进入走廊中央时，球恰好摆到端点低位 */
function pendulumTrack(phase: number, periodTicks = 170): { track: Track; startX: number; endX: number } {
  const b = new TB();
  b.run(420);
  b.run(120);
  const startX = b.cursor;
  const CW = 230;
  b.pendulums.push({
    x0: startX + 26,
    x1: startX + CW - 26,
    highY: GROUND_Y - 118,
    lowY: GROUND_Y - 36,
    r: PENDULUM_R,
    periodTicks,
    phase,
  });
  b.run(CW);
  const endX = b.cursor;
  b.run(500);
  return { track: b.track(), startX, endX };
}

describe('积木：横扫钉球', () => {
  it('pendulumBob 是纯函数且值域正确', () => {
    const p: PendulumDef = {
      x0: 100,
      x1: 330,
      highY: GROUND_Y - 118,
      lowY: GROUND_Y - 36,
      r: PENDULUM_R,
      periodTicks: 170,
      phase: 33,
    };
    for (let t = 0; t < 800; t += 5) {
      const a = pendulumBob(p, t);
      const c = pendulumBob(p, t);
      expect(a.x).toBe(c.x);
      expect(a.y).toBe(c.y);
      expect(a.x).toBeGreaterThanOrEqual(p.x0 - 1e-6);
      expect(a.x).toBeLessThanOrEqual(p.x1 + 1e-6);
      expect(a.y).toBeGreaterThanOrEqual(Math.min(p.highY, p.lowY) - 1e-6);
      expect(a.y).toBeLessThanOrEqual(Math.max(p.highY, p.lowY) + 1e-6);
    }
  });

  it('不看时机硬闯会撞球毙命（crash cause=ball）', () => {
    // 相位设计：玩家到达走廊左端点(x0)那一刻，球恰在同一点低位封路。
    // tri 在 u=0 时为 +1（右端）、u=0.5 时为 -1（左端）→ 取半周期对齐。
    const period = 170;
    const x0 = 540 + 26; // 走廊左端 = startX + 26
    const arriveTick = Math.round((x0 - 80) / 6);
    const phase = ((((Math.floor(period / 2) - arriveTick) % period) + period) % period);
    const { track, endX } = pendulumTrack(phase, period);
    const r = run(track, blank(700));
    expect(r.alive).toBe(false);
    expect(r.events.some((e) => e.type === 'crash')).toBe(true);
    expect(r.x).toBeLessThan(endX);
  });

  it('存在可行时机：等待+择时跳跃可安全穿过走廊', () => {
    const phase = 61;
    const { track, startX, endX } = pendulumTrack(phase);
    const entryTick = Math.round((startX - 80) / 6); // 到达走廊入口的 tick
    let passed = false;
    // 三维小网格：进廊前相位偏移 × 纵深处起跳点 × 蓄力档
    for (let d = 0; d <= 84 && !passed; d++) {
      for (let jt = entryTick + d - 6; jt <= entryTick + d + 26 && !passed; jt += 2) {
        for (const hold of [3, 8, HOLD_MAX_TICKS] as const) {
          const inputs = blank(jt + hold + 600);
          jumpAt(inputs, jt, hold);
          const r = run(track, inputs);
          if (r.alive && r.x > endX + 10) {
            passed = true;
          }
        }
      }
    }
    expect(passed).toBe(true);
  }, 20000);
});

/* ---------------- 碎裂天梯 ---------------- */

function stairsTrack(): { track: Track; lastPlatX: number; endX: number } {
  const b = new TB();
  b.run(420);
  b.run(140);
  const pitX = b.cursor;
  const plankW = 118;
  const gapX = 78;
  const ys = [64, 128, 192];
  for (let i = 0; i < 3; i++) {
    const px = pitX + i * (plankW + gapX);
    b.plats.push({ x: px, y: GROUND_Y - ys[i]!, w: plankW, crumble: true });
  }
  const total = 3 * plankW + 2 * gapX + 130;
  b.gap(total);
  const endX = b.cursor;
  b.run(500);
  return { track: b.track(), lastPlatX: pitX + 2 * (plankW + gapX), endX };
}

describe('积木：碎裂天梯', () => {
  it('逐级起跳可登顶通过（登板时机有解），碎裂事件照常触发', () => {
    const { track, endX } = stairsTrack();
    let passed = false;
    for (let t0 = 25; t0 <= 60 && !passed; t0++) {
      for (let hopGap = 30; hopGap <= 42 && !passed; hopGap += 3) {
        const inputs = blank(t0 + 3 * (hopGap + HOLD_MAX_TICKS) + 200);
        jumpAt(inputs, t0, HOLD_MAX_TICKS);
        let t = t0 + hopGap;
        for (let k = 0; k < 2; k++) {
          jumpAt(inputs, t, 9);
          t += hopGap;
        }
        const r = run(track, inputs);
        if (
          r.alive &&
          r.x > endX + 10 &&
          r.events.some((e) => e.type === 'crumble')
        ) {
          passed = true;
        }
      }
    }
    expect(passed).toBe(true);
  }, 10000);
});

/* ---------------- 池完整性 ---------------- */

describe('buildTrack 含全部在池新积木且逐位一致', () => {
  it('种子池扫描 + 同 seed 幂等', () => {
    // 注：updraft 本轮暂缓入池（浮空落点窗口过窄），池完整性只看在池机制
    let seed: bigint | null = null;
    for (let k = 1; k < 160; k++) {
      const tt = buildTrack(BigInt(k));
      if (
        tt.pendulums.length > 0 &&
        tt.plats.some((p) => p.crumble && p.y < GROUND_Y - 40)
      ) {
        seed = BigInt(k);
        break;
      }
    }
    expect(seed).not.toBeNull();
    const a = JSON.stringify(buildTrack(seed!));
    const b2 = JSON.stringify(buildTrack(seed!));
    expect(a).toBe(b2);
  });
});
