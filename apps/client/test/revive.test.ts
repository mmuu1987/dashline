import { beforeEach, describe, expect, it } from 'vitest';
import { createWorld, type World } from '@dashline/core';
import {
  FREE_REVIVES_PER_DAY,
  REVIVE_BACKOFF_PX,
  ReviveBank,
  ReviveCheckpointTracker,
  type GroundedSample,
} from '../src/revive.js';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const DAY = '2026-09-13';

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
});

describe('每日免费复活账本', () => {
  it('每天发放固定次数，用尽后不再发放', () => {
    const bank = new ReviveBank(DAY);
    expect(bank.remainingFree()).toBe(FREE_REVIVES_PER_DAY);
    for (let i = 0; i < FREE_REVIVES_PER_DAY; i++) {
      expect(bank.consumeFree()).toBe(true);
    }
    expect(bank.remainingFree()).toBe(0);
    expect(bank.consumeFree()).toBe(false); // 额度不足时不改变状态
    expect(bank.usedFree()).toBe(FREE_REVIVES_PER_DAY);
  });

  it('额度跨天重置，且当天已用次数会被持久化', () => {
    const first = new ReviveBank(DAY);
    first.consumeFree();
    first.consumeFree();
    expect(first.remainingFree()).toBe(FREE_REVIVES_PER_DAY - 2);

    // 同一天重新实例化（模拟刷新页面）应保留已用次数
    const reloaded = new ReviveBank(DAY);
    expect(reloaded.remainingFree()).toBe(FREE_REVIVES_PER_DAY - 2);

    // 次日恢复满额
    const nextDay = new ReviveBank('2026-09-14');
    expect(nextDay.remainingFree()).toBe(FREE_REVIVES_PER_DAY);
  });

  it('存档结构损坏或越界时安全回退', () => {
    localStorage.setItem('dl_revives_v1', '{"date":"2026-09-13","freeUsed":"many"}');
    expect(new ReviveBank(DAY).remainingFree()).toBe(FREE_REVIVES_PER_DAY);

    localStorage.setItem('dl_revives_v1', `{"date":"${DAY}","freeUsed":99}`);
    expect(new ReviveBank(DAY).remainingFree()).toBe(0);

    localStorage.setItem('dl_revives_v1', 'null');
    expect(new ReviveBank(DAY).remainingFree()).toBe(FREE_REVIVES_PER_DAY);
  });
});

describe('复活检查点滞后取样', () => {
  const groundedAt = (x: number): GroundedSample => ({ alive: true, grounded: true, x });
  const spawn = (): World => createWorld(1n);

  it('推进满回溯距离才提交，且提交的是更早取样到的位置', () => {
    const tracker = new ReviveCheckpointTracker(REVIVE_BACKOFF_PX, spawn());
    const atSpawn = tracker.checkpoint();
    const sampled = spawn();

    tracker.observe(groundedAt(1000), () => sampled);
    expect(tracker.checkpoint()).toBe(atSpawn); // 取样≠提交

    tracker.observe(groundedAt(1000 + REVIVE_BACKOFF_PX - 1), () => sampled);
    expect(tracker.checkpoint()).toBe(atSpawn);

    tracker.observe(groundedAt(1000 + REVIVE_BACKOFF_PX), () => sampled);
    expect(tracker.checkpoint()).toBe(sampled); // 提交 1000 处取到的状态，复活点在死亡点身后
  });

  it('空中与死亡状态一律不取样', () => {
    const tracker = new ReviveCheckpointTracker(REVIVE_BACKOFF_PX, spawn());
    let clones = 0;
    const count = (): World => {
      clones++;
      return spawn();
    };
    tracker.observe({ alive: true, grounded: false, x: 1000 }, count);
    tracker.observe({ alive: false, grounded: true, x: 1100 }, count);
    tracker.observe({ alive: false, grounded: false, x: 1200 }, count);
    expect(clones).toBe(0);
  });

  it('只在取样时克隆，不是每 tick 克隆', () => {
    const tracker = new ReviveCheckpointTracker(REVIVE_BACKOFF_PX, spawn());
    const shared = spawn();
    let clones = 0;
    for (let i = 0; i < 120; i++) {
      tracker.observe(groundedAt(1000 + i * 10), () => {
        clones++;
        return shared;
      });
    }
    expect(clones).toBeGreaterThan(0);
    expect(clones).toBeLessThan(10); // 120 tick 内只取样约 5 次
  });

  it('reset 回到出生点并丢弃未提交的候选', () => {
    const tracker = new ReviveCheckpointTracker(REVIVE_BACKOFF_PX, spawn());
    tracker.observe(groundedAt(1000), () => spawn());

    const freshSpawn = spawn();
    tracker.reset(freshSpawn);
    expect(tracker.checkpoint()).toBe(freshSpawn);

    // 旧候选已丢弃：再推进距离也不会把重开前的状态提交上来
    tracker.observe(groundedAt(2000), () => spawn());
    expect(tracker.checkpoint()).toBe(freshSpawn);
  });
});
