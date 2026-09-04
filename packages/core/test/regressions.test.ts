import { describe, expect, it } from 'vitest';
import { GROUND_Y, START_Y, buildTrack, createWorldWithTrack, type Track } from '../src/index.js';

function itemTrack(kind: 'shield' | 'magnet'): Track {
  return {
    grounds: [{ x0: -1_000, x1: 1_000 }],
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

  it('固定种子的赛道结构保持黄金摘要', () => {
    expect(fnv1a(JSON.stringify(buildTrack(20260904n)))).toBe('59d70a65');
  });
});
