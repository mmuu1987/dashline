import { beforeEach, describe, expect, it } from 'vitest';
import { FREE_REVIVES_PER_DAY, ReviveBank } from '../src/revive.js';

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
