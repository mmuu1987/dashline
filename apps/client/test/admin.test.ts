import { beforeEach, describe, expect, it } from 'vitest';
import { AdminChannel } from '../src/admin.js';

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

const TOKEN = 'dashline-admin';

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
});

describe('管理员通道', () => {
  it('默认关闭', () => {
    const admin = new AdminChannel('');
    expect(admin.isOn()).toBe(false);
    expect(admin.unlimitedRevives()).toBe(false);
  });

  it('口令正确时开启并持久化，之后不带参数也保持开启', () => {
    const admin = new AdminChannel(`?admin=${TOKEN}`);
    expect(admin.isOn()).toBe(true);
    expect(admin.unlimitedRevives()).toBe(true);
    // 新会话（无参数）沿用上次选择
    expect(new AdminChannel('').isOn()).toBe(true);
  });

  it('口令错误或参数无关时不开启，也不写入存档', () => {
    expect(new AdminChannel('?admin=nope').isOn()).toBe(false);
    expect(new AdminChannel('?foo=1').isOn()).toBe(false);
    expect(new AdminChannel('?admin=').isOn()).toBe(false);
    expect(localStorage.getItem('dl_admin_v1')).toBeNull();
  });

  it('admin=off 关闭并清除持久化状态', () => {
    expect(new AdminChannel(`?admin=${TOKEN}`).isOn()).toBe(true);
    const off = new AdminChannel('?admin=off');
    expect(off.isOn()).toBe(false);
    expect(new AdminChannel('').isOn()).toBe(false);
  });

  it('缺少 localStorage 时静默降级为关闭', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('storage disabled');
      },
      configurable: true,
    });
    expect(new AdminChannel(`?admin=${TOKEN}`).isOn()).toBe(true);
    expect(new AdminChannel('').isOn()).toBe(false);
  });
});
