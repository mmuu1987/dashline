/**
 * 荣誉成就系统：
 * 记录玩家在赛道上的各种精彩操作、里程碑与挑战达成情况。
 */
import {
  isRecord,
  lsGetFirst,
  lsSet,
  parseStoredJson,
  toNonNegativeInteger,
} from './storage.js';

export interface AchievementDef {
  id: string;
  title: string;
  desc: string;
  icon: string;
  unlocked: boolean;
  unlockedAt?: number;
}

const STORAGE_KEY = 'dl_achievements_v1';
const LEGACY_STORAGE_KEY = 'dl_achievements';

const INITIAL_ACHIEVEMENTS: Omit<AchievementDef, 'unlocked'>[] = [
  {
    id: 'first_finish',
    title: '初次完赛',
    desc: '成功越过所有重重难关，首次抵达终点线',
    icon: '🥇',
  },
  {
    id: 'coin_master',
    title: '满载而归',
    desc: '单局游戏中累计收集 15 枚以上宝石',
    icon: '💎',
  },
  {
    id: 'near_miss',
    title: '极限闪避',
    desc: '单局内与致命尖刺发生 2 次毫米级极限擦碰且存活',
    icon: '⚡',
  },
  {
    id: 'shield_hero',
    title: '坚不可摧',
    desc: '消耗护盾抵扣一次致命伤害后依然顺利完赛',
    icon: '🛡️',
  },
  {
    id: 'gravity_master',
    title: '乾坤颠倒',
    desc: '通过重力引力门在天花板上倒挂飞驰并安全着陆',
    icon: '🔄',
  },
  {
    id: 'streak_7',
    title: '七日传说',
    desc: '连续 7 天每日均有完赛记录',
    icon: '🔥',
  },
];

export class Achievements {
  private unlockedMap: Record<string, number> = {};

  constructor() {
    this.load();
  }

  private load(): void {
    this.unlockedMap = {};
    const parsed = parseStoredJson(lsGetFirst([STORAGE_KEY, LEGACY_STORAGE_KEY]));
    if (!isRecord(parsed)) return;
    for (const def of INITIAL_ACHIEVEMENTS) {
      const timestamp = toNonNegativeInteger(parsed[def.id]);
      if (timestamp > 0) this.unlockedMap[def.id] = timestamp;
    }
    this.save();
  }

  private save(): void {
    lsSet(STORAGE_KEY, JSON.stringify(this.unlockedMap));
  }

  getAll(): AchievementDef[] {
    return INITIAL_ACHIEVEMENTS.map((a) => ({
      ...a,
      unlocked: Boolean(this.unlockedMap[a.id]),
      unlockedAt: this.unlockedMap[a.id],
    }));
  }

  unlock(id: string): AchievementDef | null {
    if (this.unlockedMap[id]) return null;
    const def = INITIAL_ACHIEVEMENTS.find((a) => a.id === id);
    if (!def) return null;

    const now = Date.now();
    this.unlockedMap[id] = now;
    this.save();

    return {
      ...def,
      unlocked: true,
      unlockedAt: now,
    };
  }

  isUnlocked(id: string): boolean {
    return Boolean(this.unlockedMap[id]);
  }
}
