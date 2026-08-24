import { describe, expect, it } from 'vitest';
import {
  encodeInputs,
  decodeInputs,
  makeInput,
  splitmix32,
} from '@dashline/shared';
import { buildTrack, createWorld, type WorldSnapshot } from '../src/index.js';

const SEED = 12345n;

/** 用 PRNG 生成一段确定性"伪玩家"输入流（测试自身也必须可复现） */
function scriptedInputs(seed: number, ticks: number): Uint8Array {
  const r = splitmix32(seed);
  const out = new Uint8Array(ticks);
  let heldFor = 0;
  for (let i = 0; i < ticks; i++) {
    if (heldFor > 0) {
      out[i] = makeInput(false, true);
      heldFor--;
    } else if (r() < 0.08) {
      out[i] = makeInput(true, true);
      heldFor = Math.floor(r() * 18);
    }
  }
  return out;
}

/** 拟真输入流：长静默 + 短按住，接近真人节奏（压缩友好） */
function realisticInputs(ticks: number): Uint8Array {
  const r = splitmix32(2024);
  const out: number[] = [];
  while (out.length < ticks) {
    const idle = 30 + Math.floor(r() * 120);
    for (let i = 0; i < idle && out.length < ticks; i++) out.push(makeInput(false, false));
    out.push(makeInput(true, true)); // 按下边沿
    const hold = 10 + Math.floor(r() * 15);
    for (let i = 0; i < hold && out.length < ticks; i++) out.push(makeInput(false, true));
  }
  return Uint8Array.from(out.slice(0, ticks));
}

function runWorld(
  seed: bigint,
  inputs: Uint8Array,
): { snap: WorldSnapshot; events: string[] } {
  const w = createWorld(seed);
  const events: string[] = [];
  for (const b of inputs) {
    w.step(b);
    for (const e of w.takeEvents()) events.push(e.type);
    if (!w.snapshot.alive || w.snapshot.finished) break;
  }
  return { snap: w.snapshot, events };
}

describe('确定性（架构地基）', () => {
  it('同一 seed 生成完全相同的赛道', () => {
    const a = JSON.stringify(buildTrack(SEED));
    const b = JSON.stringify(buildTrack(SEED));
    expect(a).toBe(b);
  });

  it('赛道满足基本不变量', () => {
    for (const s of [1n, 42n, 12345n, 987654321n]) {
      const t = buildTrack(s);
      expect(t.finishX).toBeGreaterThanOrEqual(17000);
      expect(t.finishX).toBeLessThanOrEqual(t.length);
      expect(t.coins.length).toBeGreaterThan(40);
      expect(t.hazards.length).toBeGreaterThan(8);
      // 地面第一段必须覆盖出生点
      expect(t.grounds[0]!.x0).toBeLessThanOrEqual(80);
    }
  });

  it('同 (seed, 输入流) 两次运行逐位一致，且事件序列一致', () => {
    const inputs = scriptedInputs(777, 3600);
    const a = runWorld(SEED, inputs);
    const b = runWorld(SEED, inputs);
    expect(a.snap).toEqual(b.snap);
    expect(a.events).toEqual(b.events);
  });

  it('不同输入流产生不同结果（防"假确定性"）', () => {
    const a = runWorld(SEED, scriptedInputs(1, 1200));
    const b = runWorld(SEED, scriptedInputs(2, 1200));
    const same =
      a.snap.score === b.snap.score &&
      a.snap.alive === b.snap.alive &&
      a.snap.finished === b.snap.finished;
    expect(same).toBe(false);
  });
});

describe('codec 回环', () => {
  it('拟真输入流：encode→decode 还原，且一局压到几百字节内', () => {
    const bytes = realisticInputs(3600);
    const encoded = encodeInputs(bytes);
    expect(encoded.length).toBeLessThan(400);
    expect(Array.from(decodeInputs(encoded))).toEqual(Array.from(bytes));
  });

  it('对抗性高频流也能无损回环（不保证压缩率）', () => {
    const r = splitmix32(4242);
    const bytes = Uint8Array.from({ length: 3600 }, () => (r() < 0.9 ? 0 : 3));
    expect(Array.from(decodeInputs(encodeInputs(bytes)))).toEqual(Array.from(bytes));
  });

  it('全零流被压到极小', () => {
    const encoded = encodeInputs(new Uint8Array(3600));
    expect(encoded.length).toBeLessThan(12);
  });
});

describe('物理手感不变量', () => {
  it('点按跳高度 < 长按跳高度', () => {
    const tap = createWorld(7n);
    tap.step(makeInput(true, false)); // 按下即松
    let maxYTap = -tap.snapshot.y;
    for (let i = 0; i < 90; i++) {
      tap.step(0);
      maxYTap = Math.max(maxYTap, -tap.snapshot.y);
    }

    const hold = createWorld(7n);
    hold.step(makeInput(true, true));
    for (let i = 0; i < 20; i++) hold.step(makeInput(false, true));
    let maxYHold = -hold.snapshot.y;
    for (let i = 0; i < 90; i++) {
      hold.step(0);
      maxYHold = Math.max(maxYHold, -hold.snapshot.y);
    }
    expect(maxYHold).toBeGreaterThan(maxYTap + 40);
  });

  it('无输入最终会死于障碍或坠坑（赛道确有挑战）', () => {
    const { snap } = runWorld(SEED, new Uint8Array(7200));
    expect(snap.alive && snap.finished).toBe(false);
  });
});
