/**
 * 求解型 Bot v2：每个地面 tick 用 clone() 预演三条时间线（等待 / 点按跳 / 满蓄力跳），
 * 选择活得更久（平局则更远）的那条。适配弹跳菇、低空刺梁、碎裂板。
 */
import { GROUND_Y, PLAYER_R, createWorld, type World } from '@dashline/core';
import { HOLD_MAX_TICKS, encodeInputs, makeInput, seedForDate, todayUTC } from '@dashline/shared';

/** 落点宽容（与 world.ts 支撑判定一致：±0.6R） */
const EDGE_FORGIVE_PX = PLAYER_R * 0.6;

const seed = seedForDate(todayUTC());
const LOOKAHEAD = 200;

/** 在克隆线上预演 depth ticks：
 *  delay>0 时先等待（压过反应式，用于规划起跳位置），
 *  首 tick 用决策输入，随后 postHold 电平，其余交给反应式策略 */
/** 滞空专用反射：
 *  1) 恐慌二段跳（环授予的自救次数，由脚本层记账）；
 *  2) 坠落抢救：前方 ~110px 内出现新地面段起点（小岛/分段尽头落水前），土狼窗口内按跳。
 *  是否持有空中跳由脚本层记账（seenRings）决定，规则纯几何、确定性。 */
function airborneReflect(w: World, hasAirJump: boolean): number {
  const s = w.snapshot;
  if (
    hasAirJump &&
    !s.grounded &&
    s.vy > 0 &&
    s.y + PLAYER_R > GROUND_Y - 24
  ) {
    return makeInput(true, true);
  }
  if (
    !s.grounded &&
    s.vy > 0 &&
    s.vy < 420 &&
    s.y + PLAYER_R >= GROUND_Y - 2 &&
    s.y + PLAYER_R < GROUND_Y + 28
  ) {
    // 当前所站的段（或刚离开的段）尽头就在前方 → 提前起跳越过，避免落水
    for (const seg of w.track.grounds) {
      if (s.x > seg.x0 - 30 && s.x < seg.x1 + 110) {
        const d = seg.x1 - s.x;
        if (d > -70 && d < 110) return makeInput(true, true);
      }
    }
  }
  return 0;
}

/** 脚本层记账：本 tick 是否新进入任一未记账环的捕获窗（±32），进入则计数+1 */
function trackRings(
  w: World,
  entered: Set<number>,
  count: { n: number },
): void {
  const s = w.snapshot;
  const rings = w.track.rings;
  for (let i = 0; i < rings.length; i++) {
    if (entered.has(i)) continue;
    const rg = rings[i]!;
    if (
      Math.abs(rg.x - s.x) < 32 &&
      Math.abs(rg.y - s.y) < 32
    ) {
      entered.add(i);
      count.n = Math.min(2, count.n + 1);
    }
  }
}

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
  // 继承当前已拾取的环数（按快照 ringsGot），并随预演推进记账
  const entered = new Set<number>(clone.snapshot.ringsGot);
  const count = { n: clone.snapshot.ringsGot.length };
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
    } else if (!s.grounded) {
      // 滞空反射：只有恐慌二段跳参与预演
      inp = airborneReflect(clone, count.n > 0);
      if (inp !== 0) count.n--;
    } else if (s.grounded) {
      const r = reactivePolicy(clone);
      inp = r.inp;
      hl = r.holdLeft;
    }
    clone.step(inp);
    trackRings(clone, entered, count);
  }
  const s2 = clone.snapshot;
  return [s2.finished ? 1_000_000 : depth, s2.x - x0];
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
  // 脚本层二段跳记账
  const ringEntered = new Set<number>();
  const ringCount = { n: 0 };

  while (w.snapshot.alive && !w.snapshot.finished && w.tick < 7200) {
    const s = w.snapshot;
    let inp = 0;
    if (process.env.SOLVE_DEBUG === '1' && w.tick > 2270 && w.tick < 2345) {
      console.log(
        'pre t=' + s.tick + ' x=' + Math.round(s.x) + ' gnd=' + (s.grounded ? 1 : 0) +
          ' pLate=' + pendingLate + ' holding=' + holding + ' hl=' + holdLeft,
      );
    }
    if (!s.grounded) {
      pendingLate = 0; // 计划赶不上变化：离地即作废
      if (holding && holdLeft > 0) {
        inp = makeInput(false, true);
        holdLeft--;
      } else {
        holding = false;
        // 滞空反射：仅恐慌二段跳（press 后保持 HELD 以吃满蓄力延伸）
        const refl = airborneReflect(w, ringCount.n > 0);
        if (refl !== 0) {
          inp = refl;
          holding = true;
          holdLeft = HOLD_MAX_TICKS;
          ringCount.n--;
        }
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
      // ---- 坑沿强制起飞窗口：按下一坑宽度动态化（388 满蓄射程 − 有效坑宽 − 余量），
      //      候选投票在悬崖边不可信（历史多起事故），到点无条件满蓄起跳 ----
      let segEndDist = Infinity;
      let nextGap = 0;
      for (let gi = 0; gi < w.track.grounds.length; gi++) {
        const seg = w.track.grounds[gi]!;
        if (s.x >= seg.x0 && s.x <= seg.x1) {
          segEndDist = seg.x1 - s.x;
          const nxt = w.track.grounds[gi + 1];
          if (nxt && nxt.x0 > seg.x1) nextGap = nxt.x0 - seg.x1;
        }
      }
      const effNeed = Math.max(0, nextGap);
      // 收窄 100px：既保证普通坑有足量射程，又让菇岛落点偏右（弹射才能过第二段）
      const fireDist = Math.min(190, Math.max(25, 388 - effNeed - 100));
      const edgeForced = segEndDist < fireDist;
      if (edgeForced) {
        inp = makeInput(true, true);
        holding = true;
        holdLeft = HOLD_MAX_TICKS;
        if (process.env.SOLVE_DEBUG === '1')
          console.log(`[forced] t=${w.tick} x=${Math.round(s.x)} segEnd=${segEndDist.toFixed(0)} gap=${Math.round(nextGap)} fireAt=${fireDist}`);
      }
      if (!edgeForced) {
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
      void DBG;
      if (DBG && w.tick > 2760 && w.tick < 2840) {
        console.log(
          't=' + w.tick + ' x=' + Math.round(s.x) + ' best=' + bestName +
            ' scores=' + [rWait[0], rTap[0], rFull[0], rLate[0]].join('/'),
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
      } // end !edgeForced
    }
    w.step(inp);
    inputs.push(inp);
    trackRings(w, ringEntered, ringCount);
    w.takeEvents();
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
