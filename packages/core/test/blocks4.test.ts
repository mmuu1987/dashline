/**
 * 新积木护栏（第四批）：激光闸门（Laser Gate）与池完整性。
 */
import { describe, expect, it } from 'vitest';
import { HOLD_MAX_TICKS, makeInput } from '@dashline/shared';
import {
  GROUND_Y,
  buildTrack,
  createWorldWithTrack,
  isGateActive,
  type GateDef,
  type GroundSeg,
  type Hazard,
  type SimEvent,
  type Track,
} from '../src/index.js';

class TB {
  cursor = 0;
  private segStart = -100;
  grounds: GroundSeg[] = [];
  hazards: Hazard[] = [];
  coins: { x: number; y: number; got: boolean }[] = [];
  gates: GateDef[] = [];

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
      plats: [],
      pads: [],
      boosts: [],
      rings: [],
      winds: [],
      pendulums: [],
      gates: this.gates,
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

function gateTrack(phase: number, periodTicks = 140, activeTicks = 60): { track: Track; gateX: number } {
  const b = new TB();
  b.run(500);
  const gateX = b.cursor + 40;
  b.gates.push({
    x: gateX,
    y: GROUND_Y - 80,
    w: 16,
    h: 80,
    periodTicks,
    activeTicks,
    phase,
  });
  b.run(300);
  return { track: b.track(), gateX };
}

describe('积木：激光闸门', () => {
  it('isGateActive 是纯函数且周期严格一致', () => {
    const g: GateDef = {
      x: 200,
      y: GROUND_Y - 80,
      w: 16,
      h: 80,
      periodTicks: 120,
      activeTicks: 50,
      phase: 10,
    };
    for (let t = 0; t < 600; t++) {
      const a = isGateActive(g, t);
      const b = isGateActive(g, t + 120);
      expect(a).toBe(b);
      const expected = (t + 10) % 120 < 50;
      expect(a).toBe(expected);
    }
  });

  it('在通电状态下硬闯被激光击毙（cause=laser）', () => {
    const period = 140;
    const active = 70;
    const gateX = 540;
    const arriveTick = Math.round((gateX - 80) / 6);
    const phase = (((10 - arriveTick) % period) + period) % period;
    const { track } = gateTrack(phase, period, active);
    const r = run(track, blank(500));
    expect(r.alive).toBe(false);
    const crashEv = r.events.find((e) => e.type === 'crash') as { type: 'crash'; cause: string } | undefined;
    expect(crashEv).toBeDefined();
    expect(crashEv?.cause).toBe('laser');
  });

  it('在断电安全窗口平跑顺利穿过', () => {
    const period = 140;
    const active = 50;
    const gateX = 540;
    const arriveTick = Math.round((gateX - 80) / 6);
    const phase = (((80 - arriveTick) % period) + period) % period;
    const { track } = gateTrack(phase, period, active);
    const r = run(track, blank(500));
    expect(r.alive).toBe(true);
    expect(r.x).toBeGreaterThan(gateX + 50);
  });

  it('即使通电中，也可以通过起跳从上方越过闸门', () => {
    const period = 140;
    const active = 140;
    const { track, gateX } = gateTrack(0, period, active);
    const arriveTick = Math.round((gateX - 80) / 6);
    const inputs = blank(600);
    jumpAt(inputs, arriveTick - 24, HOLD_MAX_TICKS);
    const r = run(track, inputs);
    expect(r.alive).toBe(true);
    expect(r.x).toBeGreaterThan(gateX + 50);
  });
});

describe('积木池完整性与确定性', () => {
  it('buildTrack 生成包含激光闸门与上升气流柱的赛道且跨次一致', () => {
    let hasGate = false;
    let hasWind = false;
    for (let k = 1; k <= 30; k++) {
      const t = buildTrack(BigInt(k));
      if (t.gates.length > 0) hasGate = true;
      if (t.winds.length > 0) hasWind = true;
    }
    expect(hasGate).toBe(true);
    expect(hasWind).toBe(true);

    const s = 20260828n;
    const t1 = JSON.stringify(buildTrack(s));
    const t2 = JSON.stringify(buildTrack(s));
    expect(t1).toBe(t2);
  });
});
