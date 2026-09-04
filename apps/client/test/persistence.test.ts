import { beforeEach, describe, expect, it } from 'vitest';
import { Achievements } from '../src/achievements.js';
import { loadBestRecord } from '../src/best-record.js';
import { calculateStreak, loadHistory, saveDayRecord } from '../src/meta.js';
import { Talents } from '../src/talents.js';
import { Wardrobe } from '../src/wardrobe.js';

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

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
});

describe('本地存档校验与迁移', () => {
  it('合法 JSON 但结构错误时安全回退默认值', () => {
    localStorage.setItem('dl_talents_v1', 'null');
    localStorage.setItem('dl_achievements_v1', '[]');
    localStorage.setItem('dl_history_v1', '{"days":null}');
    localStorage.setItem('dl_wardrobe_v1', '{"totalCoins":"many","unlockedIds":[null]}');
    localStorage.setItem('dl_best_v1_2026-09-04', 'null');

    expect(new Talents().getLevel('shield')).toBe(0);
    expect(new Achievements().isUnlocked('first_finish')).toBe(false);
    expect(loadHistory()).toEqual({ days: {} });
    expect(new Wardrobe().getTotalCoins()).toBe(0);
    expect(loadBestRecord('2026-09-04')).toBeNull();
  });

  it('迁移旧版天赋、成就、衣橱和每日最佳 key', () => {
    localStorage.setItem('dl_talents', '{"start_shield":1,"magnet_mastery":99,"unknown":3}');
    localStorage.setItem('dl_achievements', '{"first_finish":1234,"unknown":9}');
    localStorage.setItem('dl_total_coins', '88');
    localStorage.setItem('dl_unlocked_skins', '["sakura","invalid"]');
    localStorage.setItem('dl_equipped_skin', 'sakura');
    localStorage.setItem(
      'dl_best_2026-09-04',
      '{"score":1200,"timeMs":3000,"coins":2,"distanceM":44,"finished":false}',
    );

    expect(new Talents().getLevel('start_shield')).toBe(1);
    expect(new Talents().getLevel('magnet_mastery')).toBe(3);
    expect(new Achievements().isUnlocked('first_finish')).toBe(true);
    const wardrobe = new Wardrobe();
    expect(wardrobe.getTotalCoins()).toBe(88);
    expect(wardrobe.getEquippedSkinId()).toBe('sakura');
    expect(loadBestRecord('2026-09-04')?.score).toBe(1200);

    expect(localStorage.getItem('dl_talents_v1')).not.toBeNull();
    expect(localStorage.getItem('dl_achievements_v1')).not.toBeNull();
    expect(localStorage.getItem('dl_wardrobe_v1')).not.toBeNull();
    expect(localStorage.getItem('dl_best_v1_2026-09-04')).not.toBeNull();
  });
});

describe('每日历史与连续完赛', () => {
  function save(date: string, finished: boolean, score = 100, attempts = 1): void {
    saveDayRecord({
      date,
      score,
      timeMs: 1_000,
      distanceM: 10,
      coins: 1,
      finished,
      attempts,
      updatedAt: Date.parse(`${date}T12:00:00Z`),
    });
  }

  it('失败记录不计连续完赛，连续七天完赛计为 7', () => {
    const dates = [
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
    ];
    for (const date of dates) save(date, false);
    expect(calculateStreak('2026-09-04')).toBe(0);
    for (const date of dates) save(date, true);
    expect(calculateStreak('2026-09-04')).toBe(7);
  });

  it('后续低分仍更新尝试次数并保留最高分', () => {
    save('2026-09-04', false, 500, 1);
    save('2026-09-04', false, 100, 4);
    expect(loadHistory().days['2026-09-04']).toMatchObject({ score: 500, attempts: 4 });
  });
});
