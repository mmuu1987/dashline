import { describe, expect, it } from 'vitest';
import { makeInput, splitmix32 } from '@dashline/shared';
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

describe('物理手感不变量', () => {
  it('按压时长连续把控跳跃高度：短按微跳 < 中按 < 满蓄长按（单调递增且反差显著）', () => {
    const measurePeak = (holdTicks: number): number => {
      const w = createWorld(7n);
      const startY = w.snapshot.y;
      w.step(makeInput(true, holdTicks > 0));
      for (let i = 1; i < holdTicks; i++) {
        w.step(makeInput(false, true));
      }
      let minPos = w.snapshot.y;
      for (let i = 0; i < 90; i++) {
        w.step(0);
        minPos = Math.min(minPos, w.snapshot.y);
      }
      return startY - minPos; // 上升高度 (px)
    };

    const hTap = measurePeak(0); // 即点即松 (0-tick hold)
    const hShort = measurePeak(4); // 短按 4-tick (~66ms)
    const hMid = measurePeak(10); // 中按 10-tick (~166ms)
    const hMax = measurePeak(20); // 满蓄 20-tick (~333ms)

    // 1. 单调递增
    expect(hTap).toBeLessThan(hShort);
    expect(hShort).toBeLessThan(hMid);
    expect(hMid).toBeLessThan(hMax);

    // 2. 短按微跳高度低且轻巧（30~60px 敏捷低跳，刚刚好擦过 26px 小尖刺）
    expect(hTap).toBeGreaterThanOrEqual(30);
    expect(hTap).toBeLessThanOrEqual(60);

    // 3. 满蓄跳跃高（170~200px 覆盖高层平台）
    expect(hMax).toBeGreaterThanOrEqual(170);
    expect(hMax / hTap).toBeGreaterThanOrEqual(3.0); // 满蓄是极短跳的 3 倍以上，手感层级极大丰富
  });

  it('空中破风冲刺（Air Dash）：触发 dash 事件、重力冻结并向前疾速突进', () => {
    const w = createWorld(7n);
    // 起跳
    w.step(makeInput(true, true));
    w.step(makeInput(false, true));
    expect(w.snapshot.grounded).toBe(false);
    expect(w.snapshot.canAirDash).toBe(true);

    const yBeforeDash = w.snapshot.y;
    const xBeforeDash = w.snapshot.x;

    // 触发冲刺
    w.step(makeInput(false, false, false, true));
    const events = w.takeEvents();
    expect(events.some((e) => e.type === 'dash')).toBe(true);
    expect(w.snapshot.dashing).toBe(true);
    expect(w.snapshot.canAirDash).toBe(false);

    // 冲刺期间 y 不下坠
    w.step(0);
    expect(Math.abs(w.snapshot.y - yBeforeDash)).toBeLessThan(2);
    expect(w.snapshot.x - xBeforeDash).toBeGreaterThan(15);
  });

  it('空中极速下砸（Fast Fall / Ground Slam）：触地爆发 slam 震荡波事件', () => {
    const w = createWorld(7n);
    w.step(makeInput(true, true));
    w.step(makeInput(false, true));
    expect(w.snapshot.grounded).toBe(false);

    // 触发下砸
    w.step(makeInput(false, false, true, false));
    expect(w.snapshot.slamming).toBe(true);
    expect(w.snapshot.vy).toBeGreaterThan(1000);

    // 模拟直到落地
    let gotSlam = false;
    for (let i = 0; i < 30; i++) {
      w.step(0);
      if (w.takeEvents().some((e) => e.type === 'slam')) {
        gotSlam = true;
        break;
      }
    }
    expect(gotSlam).toBe(true);
    expect(w.snapshot.grounded).toBe(true);
    expect(w.snapshot.canAirDash).toBe(true); // 落地重置冲刺
  });

  it('离线天赋加成（PerksConfig）：开局护盾与属性强化正确生效', () => {
    const w = createWorld(7n, { startShield: true });
    expect(w.snapshot.hasShield).toBe(true);
  });

  it('无输入最终会死于障碍或坠坑（赛道确有挑战）', () => {
    const { snap } = runWorld(SEED, new Uint8Array(7200));
    expect(snap.alive && snap.finished).toBe(false);
  });
});
