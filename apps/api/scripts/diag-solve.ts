/** 追踪求解器在死亡点附近的决策（临场诊断用） */
import { createWorld } from '@dashline/core';
import { makeInput, seedForDate, todayUTC } from '@dashline/shared';

const seed = seedForDate(todayUTC());
const LOOKAHEAD = 130;
const TRACE_NEAR = Number(process.env.TRACE_NEAR ?? 4300); // 只打印此 x 之后的决策

function reactivePolicy(w: any): { inp: number; holdLeft: number } {
  const x = w.snapshot.x;
  let spikeAhead = false;
  for (const hz of w.track.hazards) {
    if (hz.y + hz.h > 400 && hz.x + hz.w < x - 10) continue;
    if (hz.x > x + 150) break;
    if (hz.y + hz.h <= 400) continue;
    if (hz.x + hz.w > x) spikeAhead = true;
  }
  let gapAhead = false;
  for (const seg of w.track.grounds) {
    if (x >= seg.x0 && x <= seg.x1 && seg.x1 - x < 60) gapAhead = true;
  }
  if (gapAhead) return { inp: makeInput(true, true), holdLeft: 18 };
  if (spikeAhead) return { inp: makeInput(true, true), holdLeft: 3 };
  return { inp: 0, holdLeft: 0 };
}

function rollout(clone: any, firstInp: number, postHold: number, depth: number): [number, number] {
  const x0 = clone.snapshot.x;
  let hl = postHold;
  let first = true;
  for (let i = 0; i < depth; i++) {
    const s = clone.snapshot;
    if (!s.alive || s.finished) return [i, s.x - x0];
    let inp: number;
    if (first) {
      inp = firstInp;
      first = false;
    } else if (hl > 0 && !s.grounded) {
      inp = makeInput(false, true);
      hl--;
    } else if (s.grounded) {
      const r = reactivePolicy(clone);
      inp = r.inp;
      hl = r.holdLeft;
    } else {
      inp = 0;
    }
    clone.step(inp);
  }
  const s = clone.snapshot;
  return [depth, s.x - x0];
}

const w = createWorld(seed);
const inputs: number[] = [];
let holding = false;
let holdLeft = 0;

while (w.snapshot.alive && !w.snapshot.finished && w.tick < 7200) {
  const s = w.snapshot;
  let inp = 0;
  if (s.grounded) {
    const rWait = rollout(w.clone(), 0, 0, LOOKAHEAD);
    const rTap = rollout(w.clone(), makeInput(true, true), 4, LOOKAHEAD);
    const rFull = rollout(w.clone(), makeInput(true, true), 15, LOOKAHEAD);
    if (s.x > TRACE_NEAR) {
      console.log(
        `tick=${s.tick} x=${Math.round(s.x)} | wait=[${rWait[0]},${Math.round(rWait[1])}] tap=[${rTap[0]},${Math.round(rTap[1])}] full=[${rFull[0]},${Math.round(rFull[1])}]`,
      );
    }
    const pickFull =
      rFull[0] > rTap[0] || (rFull[0] === rTap[0] && rFull[1] >= rTap[1]);
    const pickTap =
      !pickFull && (rTap[0] > rWait[0] || (rTap[0] === rWait[0] && rTap[1] >= rWait[1]));
    if (pickFull) {
      inp = makeInput(true, true);
      holding = true;
      holdLeft = 15;
      if (s.x > TRACE_NEAR) console.log('  -> FULL');
    } else if (pickTap) {
      inp = makeInput(true, true);
      holding = true;
      holdLeft = 4;
      if (s.x > TRACE_NEAR) console.log('  -> TAP');
    } else {
      holding = false;
      if (s.x > TRACE_NEAR) console.log('  -> WAIT');
    }
  } else if (holding && holdLeft > 0) {
    inp = makeInput(false, true);
    holdLeft--;
  } else {
    holding = false;
  }
  w.step(inp);
  inputs.push(inp);
  if (!w.snapshot.alive || w.snapshot.finished) break;
}
console.log(`结果: alive=${w.snapshot.alive} finished=${w.snapshot.finished} x=${Math.round(w.snapshot.x)} distM=${w.snapshot.distanceM}`);
