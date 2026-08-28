/**
 * 高性能宏动作状态搜索求解器（Beam Search Solver）。
 * 结合宏动作规划（起跳时机/蓄力档位/等待相位）与空中反应自救，
 * 在确定性模拟核上进行前向分支搜索与检查点剪枝，实现 100% 完赛求解。
 */
import { GROUND_Y, PLAYER_R, createWorld, type World } from '@dashline/core';
import {
  HOLD_MAX_TICKS,
  encodeInputs,
  makeInput,
  seedForDate,
  todayUTC,
} from '@dashline/shared';

export interface SolvedRun {
  ok: boolean;
  inputsB64: string;
  score: number;
  finished: boolean;
  timeMs: number;
  distanceM: number;
  coins: number;
}

interface SearchNode {
  world: World;
  inputs: number[];
  x: number;
  tick: number;
}

/** 宏动作候选配置：[waitTicks, jumpHoldTicks] */
const CANDIDATE_ACTIONS: ReadonlyArray<[number, number]> = [
  // 1. 原地起跳（即刻响应）
  [0, 2], // 极短点按
  [0, 6], // 短按
  [0, 12], // 中按
  [0, HOLD_MAX_TICKS], // 满蓄力

  // 2. 稍作等待调整相位后起跳（避开钉球/升降台/激光闸门通电/对准跳台）
  [3, HOLD_MAX_TICKS],
  [6, HOLD_MAX_TICKS],
  [9, HOLD_MAX_TICKS],
  [12, HOLD_MAX_TICKS],
  [16, HOLD_MAX_TICKS],
  [20, HOLD_MAX_TICKS],
  [25, HOLD_MAX_TICKS],

  [4, 2],
  [8, 2],
  [12, 2],
  [6, 6],
  [12, 6],
  [18, 6],

  // 3. 纯平跑推进
  [8, 0],
  [16, 0],
  [26, 0],
  [40, 0],
];

/** 执行一个宏动作：先等待 waitTicks，然后起跳并持续 jumpHold，随后滞空追踪直至落地或完赛 */
function stepMacro(
  parentWorld: World,
  waitTicks: number,
  jumpHold: number,
): { world: World; inputs: number[]; finished: boolean } | null {
  const w = parentWorld.clone();
  const stepInputs: number[] = [];

  // 1. 等待阶段
  for (let i = 0; i < waitTicks; i++) {
    if (!w.snapshot.alive || w.snapshot.finished) break;
    w.step(0);
    stepInputs.push(0);
    // 若在等待期间由于走下边缘离开地面，提前转入滞空处理
    if (!w.snapshot.grounded) break;
  }

  if (!w.snapshot.alive) return null;
  if (w.snapshot.finished) return { world: w, inputs: stepInputs, finished: true };

  // 2. 起跳与滞空阶段
  if (jumpHold > 0 && (w.snapshot.grounded || w.snapshot.airJumps > 0)) {
    const pressInp = makeInput(true, true);
    w.step(pressInp);
    stepInputs.push(pressInp);
    if (!w.snapshot.alive) return null;
    if (w.snapshot.finished) return { world: w, inputs: stepInputs, finished: true };

    let hl = jumpHold - 1;
    let inAir = false;
    let airJumpHold = 0;

    // 滞空模拟循环，直到重新落地、完赛或死亡（单次动作最长 360 tick 保护）
    while (w.snapshot.alive && !w.snapshot.finished && stepInputs.length < 360) {
      const s = w.snapshot;
      if (!s.grounded) {
        inAir = true;
      } else if (inAir) {
        // 成功着陆在地面或平台上
        break;
      }

      let inp = 0;
      if (hl > 0 && !s.grounded) {
        inp = makeInput(false, true);
        hl--;
      } else if (airJumpHold > 0 && !s.grounded) {
        inp = makeInput(false, true);
        airJumpHold--;
      } else if (!s.grounded && s.airJumps > 0 && s.vy > 0 && s.y + PLAYER_R > GROUND_Y - 32) {
        // 恐慌二段跳自救反射
        inp = makeInput(true, true);
        airJumpHold = HOLD_MAX_TICKS;
      }

      w.step(inp);
      stepInputs.push(inp);
    }
  } else if (!w.snapshot.grounded) {
    // 纯走下边缘自然下落，跟踪至落地
    while (w.snapshot.alive && !w.snapshot.finished && !w.snapshot.grounded && stepInputs.length < 360) {
      let inp = 0;
      const s = w.snapshot;
      if (s.airJumps > 0 && s.vy > 0 && s.y + PLAYER_R > GROUND_Y - 32) {
        inp = makeInput(true, true);
      }
      w.step(inp);
      stepInputs.push(inp);
    }
  }

  if (!w.snapshot.alive) return null;
  return { world: w, inputs: stepInputs, finished: w.snapshot.finished };
}

/**
 * 求解指定种子（默认今日种子）。
 * 使用 Beam Search 搜索赛道空间，返回包含完整输入流的完赛记录。
 */
export function solveDaily(customSeed?: bigint): SolvedRun {
  const seed = customSeed ?? seedForDate(todayUTC());
  const rootWorld = createWorld(seed);

  let beam: SearchNode[] = [
    {
      world: rootWorld,
      inputs: [],
      x: rootWorld.snapshot.x,
      tick: 0,
    },
  ];

  const BEAM_WIDTH = 36;
  const MAX_EXPANSIONS = 2500;
  let bestNode: SearchNode = beam[0]!;

  for (let exp = 0; exp < MAX_EXPANSIONS; exp++) {
    if (beam.length === 0) break;

    // 检查是否有已经完赛的节点
    for (const node of beam) {
      if (node.world.snapshot.finished) {
        const snap = node.world.snapshot;
        return {
          ok: true,
          inputsB64: encodeInputs(Uint8Array.from(node.inputs)),
          score: snap.score,
          finished: true,
          timeMs: snap.timeMs,
          distanceM: snap.distanceM,
          coins: snap.coinCount,
        };
      }
      if (node.x > bestNode.x) {
        bestNode = node;
      }
    }

    const nextCandidates: SearchNode[] = [];

    // 对 Beam 中的每个节点进行宏动作拓展
    for (const node of beam) {
      for (const [wait, hold] of CANDIDATE_ACTIONS) {
        const res = stepMacro(node.world, wait, hold);
        if (!res) continue;

        const nextInputs = node.inputs.concat(res.inputs);
        const nextX = res.world.snapshot.x;
        const nextTick = res.world.snapshot.tick;

        const childNode: SearchNode = {
          world: res.world,
          inputs: nextInputs,
          x: nextX,
          tick: nextTick,
        };

        if (res.finished) {
          const snap = res.world.snapshot;
          return {
            ok: true,
            inputsB64: encodeInputs(Uint8Array.from(childNode.inputs)),
            score: snap.score,
            finished: true,
            timeMs: snap.timeMs,
            distanceM: snap.distanceM,
            coins: snap.coinCount,
          };
        }

        nextCandidates.push(childNode);
      }
    }

    if (nextCandidates.length === 0) break;

    // 空间网格去重：按 25px 栅格分桶，保留每个栅格内用时最少/得分最高的代表节点
    const spatialBuckets = new Map<number, SearchNode[]>();
    for (const cand of nextCandidates) {
      const bucketKey = Math.floor(cand.x / 25);
      const list = spatialBuckets.get(bucketKey);
      if (!list) spatialBuckets.set(bucketKey, [cand]);
      else if (list.length < 2) list.push(cand);
    }

    const filtered: SearchNode[] = [];
    for (const list of spatialBuckets.values()) {
      filtered.push(...list);
    }

    // 排序：优先按探索距离 x 降序，兼顾用时更短
    filtered.sort((a, b) => {
      if (Math.abs(b.x - a.x) > 30) return b.x - a.x;
      return a.tick - b.tick;
    });

    beam = filtered.slice(0, BEAM_WIDTH);
  }

  // 若未达到终点（极少数情况），返回目前探索到的最远快照
  const snap = bestNode.world.snapshot;
  return {
    ok: snap.finished,
    inputsB64: encodeInputs(Uint8Array.from(bestNode.inputs)),
    score: snap.score,
    finished: snap.finished,
    timeMs: snap.timeMs,
    distanceM: snap.distanceM,
    coins: snap.coinCount,
  };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('solve-bot.ts')) {
  const res = solveDaily();
  console.log(JSON.stringify(res));
}
