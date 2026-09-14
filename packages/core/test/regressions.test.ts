import { describe, expect, it } from 'vitest';
import {
  GROUND_Y,
  PLAYER_R,
  START_Y,
  buildTrack,
  createWorldWithTrack,
  type Track,
} from '../src/index.js';

function itemTrack(kind: 'shield' | 'magnet'): Track {
  return {
    grounds: [{ x0: -1_000, x1: 1_000, y: GROUND_Y }],
    hazards: [],
    coins: [],
    plats: [],
    pads: [],
    boosts: [],
    rings: [],
    winds: [],
    pendulums: [],
    gates: [],
    portals: [],
    shields: kind === 'shield'
      ? [{ x: 900, y: GROUND_Y - 100, got: false }, { x: 86, y: START_Y, got: false }]
      : [],
    magnets: kind === 'magnet'
      ? [{ x: 900, y: GROUND_Y - 100, got: false }, { x: 86, y: START_Y, got: false }]
      : [],
    finishX: 900,
    length: 1_000,
  };
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

describe('审计回归护栏', () => {
  it.each(['shield', 'magnet'] as const)('%s 事件携带实际道具下标', (kind) => {
    const world = createWorldWithTrack(1n, itemTrack(kind));
    world.step(0);
    expect(world.takeEvents()).toContainEqual({ type: kind, index: 1 });
  });

  it('宝石暴击按 seed 与宝石下标独立派生，而非按拾取 tick 成组触发', () => {
    const track: Track = {
      ...itemTrack('shield'),
      shields: [],
      coins: [
        { x: 86, y: START_Y, got: false },
        { x: 86, y: START_Y, got: false },
      ],
    };
    const world = createWorldWithTrack(2n, track, { gemMultiplierChance: 0.4 });
    world.step(0);

    // seed=2 时 index 0 不暴击、index 1 暴击；同 tick 收集仍得到独立结果。
    expect(world.snapshot.coinCount).toBe(3);
    expect(world.takeEvents().filter((event) => event.type === 'coin')).toHaveLength(2);
  });

  it('固定种子的赛道结构保持黄金摘要', () => {
    // core.15：碰撞判定改用推进后的 x + 台阶接住条款（修复高速撞上略高地面掉坑）
    expect(fnv1a(JSON.stringify(buildTrack(20260904n)))).toBe('e2210c02');
  });

  it('高速撞上略高的坑沿时会被接住，而不是穿进地形坠坑', () => {
    // 回归：坑宽 120、远岸比基准高 10px（恰好一级坡道台阶）。
    // 旧实现在"脚底越过远岸顶面"那一 tick 已经满足 feet > g.y，
    // 使 prevFeet <= g.y 不成立，玩家会贴着远岸侧面一路坠到坑底。
    const edge = 600;
    const pit = 120;
    const rise = 10;
    const track: Track = {
      ...itemTrack('shield'),
      shields: [],
      grounds: [
        { x0: -2_000, x1: edge, y: GROUND_Y },
        { x0: edge + pit, x1: edge + pit + 6_000, y: GROUND_Y - rise },
      ],
      finishX: 1_000_000,
      length: 1_000_000,
    };
    const world = createWorldWithTrack(1n, track);

    // 起跳后长按，落点正好压在远岸坑沿上
    let landed = false;
    for (let i = 0; i < 400 && world.snapshot.alive; i++) {
      const jumping = i >= 42 && i < 42 + 22;
      world.step(jumping ? 0b011 : 0);
      if (world.snapshot.grounded && world.snapshot.x > edge + pit) {
        landed = true;
        break;
      }
    }

    expect(world.snapshot.alive).toBe(true);
    expect(landed).toBe(true);
    // 脚底应精确贴在远岸顶面，而不是嵌进地形里
    expect(world.snapshot.y + PLAYER_R).toBeCloseTo(GROUND_Y - rise, 5);
  });
});
