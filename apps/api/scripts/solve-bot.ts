/**
 * 求解型 Bot v2：每个地面 tick 用 clone() 预演三条时间线（等待 / 点按跳 / 满蓄力跳），
 * 选择活得更久（平局则更远）的那条。适配弹跳菇、低空刺梁、碎裂板。
 */
import { GROUND_Y, PLAYER_R, createWorld, type World } from '@dashline/core';
import { HOLD_MAX_TICKS, encodeInputs, makeInput, seedForDate, todayUTC } from '@dashline/shared';

const seed = seedForDate(todayUTC());
const LOOKAHEAD = 200;

/** 在克隆线上预演 depth ticks：
 *  delay>0 时先等待（压过反应式，用于规划起跳位置），
 *  首 tick 用决策输入，随后 postHold 电平，其余交给反应式策略 */
function rollout(
  clone: World,
  firstInp: number,
  postHold: number,
  depth: number,
  delay = 0,
): [number, number] {
  const x0 = clone.snapshot.x;
  let hl = postHold;
  let phase: 'delay' | 'first' | 'run' = delay > 0 ? 'delay' : 'first';
  let dLeft = delay;
  for (let i = 0; i < depth; i++) {
    const s = clone.snapshot;
    // 完赛压倒一切（越快分越高），其余按存活 tick 数
    if (!s.alive || s.finished)
      return [s.finished ? 1_000_000 - i : i, s.x - x0];
    let inp = 0;
    if (phase === 'delay') {
      inp = 0;
      if (--dLeft === 0 || !s.grounded) phase = 'first';
    } else if (phase === 'first') {
      inp = firstInp;
      phase = 'run';
    } else if (hl > 0 && !s.grounded) {
      inp = makeInput(false, true);
      hl--;
    } else if (s.grounded) {
      const r = reactivePolicy(clone);
      inp = r.inp;
      hl = r.holdLeft;
    }
    clone.step(inp);
  }
  const s = clone.snapshot;
  return [s.finished ? 1_000_000 : depth, s.x - x0];
}
function reactivePolicy(w: World): { inp: number; holdLeft: number } {
  const s = w.snapshot;
  const x = s.x;
  // 恐慌二段跳：坠落到低于地面标高且还有空中跳 → 立刻满蓄力空中跳自救
  if (!s.grounded && s.vy > 0 && s.y + PLAYER_R > GROUND_Y - 24 && s.airJumps > 0) {
    return { inp: makeInput(true, true), holdLeft: HOLD_MAX_TICKS };
  }
  let spikeAhead = false;
  let carpet: { x: number; w: number } | null = null; // 超宽刺毯（升降台段）
  for (const hz of w.track.hazards) {
    if (hz.x + hz.w < x - 10) continue; // 只看前方
    if (hz.x > x + 150) break;
    if (hz.y + hz.h <= GROUND_Y - 60) continue; // 悬梁不需要跳
    spikeAhead = true;
    if (hz.w > 140 && hz.x > x) carpet = { x: hz.x, w: hz.w };
  }
  let gapAhead = false;
  for (const seg of w.track.grounds) {
    if (x >= seg.x0 && x <= seg.x1 && seg.x1 - x < 60) gapAhead = true;
  }
  // 浮台/碎裂板边缘：站着的平台快到头了（板间空隙对 grounds 扫描是盲区）
  const broken = new Set(s.crumblesBroken);
  let platEdgeAhead = false;
  for (let i = 0; i < w.track.plats.length; i++) {
    const p = w.track.plats[i]!;
    if (broken.has(i)) continue;
    if (x >= p.x && x <= p.x + p.w && p.x + p.w - x < 50) {
      platEdgeAhead = true;
      break;
    }
  }
  if (gapAhead || platEdgeAhead)
    return { inp: makeInput(true, true), holdLeft: HOLD_MAX_TICKS };
  // 宽刺毯：提前起跳会落进毯中 —— 贴到边前 ~55px 才满蓄力起跳
  if (carpet && carpet.x - x <= 55) return { inp: makeInput(true, true), holdLeft: HOLD_MAX_TICKS };
  if (spikeAhead) return { inp: makeInput(true, true), holdLeft: 3 };
  return { inp: 0, holdLeft: 0 };
}

// ---- 求解主循环 ----

export interface SolvedRun {
  ok: boolean;
  inputsB64: string;
  score: number;
  finished: boolean;
  timeMs: number;
  distanceM: number;
  coins: number;
}

export function solveDaily(): SolvedRun {
  const w = createWorld(seed);
  const inputs: number[] = [];
  let holding = false;
  let holdLeft = 0;
  /** 已承诺的"延迟起跳"剩余等待 tick —— 防止每 tick 重评估导致无限拖延 */
  let pendingLate = 0;

  while (w.snapshot.alive && !w.snapshot.finished && w.tick < 7200) {
    const s = w.snapshot;
    let inp = 0;
    if (!s.grounded) {
      pendingLate = 0; // 计划赶不上变化：离地即作废
      if (holding && holdLeft > 0) {
        inp = makeInput(false, true);
        holdLeft--;
      } else {
        holding = false;
      }
    } else if (pendingLate > 0) {
      // ---- 兑现 late 承诺：倒计时结束立刻满蓄力起跳 ----
      pendingLate--;
      inp = 0;
      if (pendingLate === 0) {
        inp = makeInput(true, true);
        holding = true;
        holdLeft = HOLD_MAX_TICKS;
      }
    } else {
      // 四选一：等 / 点按(hold2) / 满蓄力 / 延迟12tick满蓄力（规划起跳位置）
      const rWait = rollout(w.clone(), 0, 0, LOOKAHEAD);
      const rTap = rollout(w.clone(), makeInput(true, true), 2, LOOKAHEAD);
      const rFull = rollout(w.clone(), makeInput(true, true), HOLD_MAX_TICKS, LOOKAHEAD);
      const rLate = rollout(w.clone(), makeInput(true, true), HOLD_MAX_TICKS, LOOKAHEAD, 12);
      const cands: Array<[string, number, number]> = [
        ['wait', rWait[0], rWait[1]],
        ['tap', rTap[0], rTap[1]],
        ['full', rFull[0], rFull[1]],
        ['late', rLate[0], rLate[1]],
      ];
      let bestName = 'wait';
      let bestS = -1;
      let bestX = -1;
      for (const [name, surv, dx] of cands) {
        if (surv > bestS || (surv === bestS && dx > bestX)) {
          bestName = name;
          bestS = surv;
          bestX = dx;
        }
      }
      const DBG = process.env.SOLVE_DEBUG === '1';
      if (DBG && w.tick > 360 && w.tick < 430) {
        console.log(
          `t=${w.tick} x=${Math.round(s.x)} best=${bestName} scores=` +
            cands.map((c) => `${c[0]}:${c[1]}/${Math.round(c[2])}`).join(' '),
        );
      }
      if (bestName === 'full') {
        inp = makeInput(true, true);
        holding = true;
        holdLeft = HOLD_MAX_TICKS;
      } else if (bestName === 'late') {
        // 承诺延迟计划：接下来 11 tick 不按，第 12 tick 起跳（与 rollout 语义一致）
        pendingLate = 11;
        inp = 0;
        holding = false;
      } else if (bestName === 'tap') {
        inp = makeInput(true, true);
        holding = true;
        holdLeft = 2;
      } else {
        // 全部候选打平时的"wait"：信任反应式策略 —— wait 线内部正是靠它在边缘起跳才活命，
        // 真实执行也必须在到达触发点时真的跳（否则会站着走进坑，见 core.5 回归）。
        holding = false;
        const rr = reactivePolicy(w);
        if (rr.inp !== 0) {
          inp = rr.inp;
          holding = true;
          holdLeft = rr.holdLeft;
        }
      }
    }
    w.step(inp);
    inputs.push(inp);
    if (!w.snapshot.alive || w.snapshot.finished) break;
  }

  const snap = w.snapshot;
  return {
    ok: snap.finished,
    inputsB64: encodeInputs(Uint8Array.from(inputs)),
    score: snap.score,
    finished: snap.finished,
    timeMs: snap.timeMs,
    distanceM: snap.distanceM,
    coins: snap.coinCount,
  };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('solve-bot.ts')) {
  console.log(JSON.stringify(solveDaily()));
}
