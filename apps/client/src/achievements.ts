/**
 * 成就系统：6 大核心成就追踪、持久化存储与解锁提示。
 */

export interface AchievementDef {
  id: string;
  icon: string;
  title: string;
  desc: string;
  unlocked: boolean;
  unlockedAt?: number;
}

const ACHIEVEMENTS: Omit<AchievementDef, 'unlocked'>[] = [
  {
    id: 'first_finish',
    icon: '🥇',
    title: '初次完赛',
    desc: '成功越过所有重重难关，首次抵达终点线',
  },
  {
    id: 'coin_master',
    icon: '💎',
    title: '满载而归',
    desc: '单局游戏中累计收集 15 枚以上宝石',
  },
  {
    id: 'near_miss',
    icon: '⚡',
    title: '极限闪避',
    desc: '单局内与致命尖刺发生 2 次毫厘级极限擦碰且存活',
  },
  {
    id: 'shield_hero',
    icon: '🛡️',
    title: '坚不可摧',
    desc: '消耗护盾抵扣一次致命伤害后依然顺利完赛',
  },
  {
    id: 'gravity_master',
    icon: '🔄',
    title: '乾坤颠倒',
    desc: '成功穿越重力反转门并在天花板上倒挂飞驰',
  },
  {
    id: 'streak_7',
    icon: '🔥',
    title: '七日连胜',
    desc: '连续 7 天每日至少完赛通关一次',
  },
];

const LS_ACHIEVEMENTS_KEY = 'dl_achievements';

export class Achievements {
  private unlockedMap = new Map<string, number>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(LS_ACHIEVEMENTS_KEY);
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, number>;
        for (const [k, v] of Object.entries(obj)) {
          this.unlockedMap.set(k, v);
        }
      }
    } catch {
      /* 忽略 */
    }
  }

  private save(): void {
    try {
      const obj: Record<string, number> = {};
      for (const [k, v] of this.unlockedMap.entries()) obj[k] = v;
      localStorage.setItem(LS_ACHIEVEMENTS_KEY, JSON.stringify(obj));
    } catch {
      /* 忽略 */
    }
  }

  getAll(): AchievementDef[] {
    return ACHIEVEMENTS.map((a) => ({
      ...a,
      unlocked: this.unlockedMap.has(a.id),
      unlockedAt: this.unlockedMap.get(a.id),
    }));
  }

  unlock(id: string): AchievementDef | null {
    if (this.unlockedMap.has(id)) return null;
    const a = ACHIEVEMENTS.find((item) => item.id === id);
    if (!a) return null;
    this.unlockedMap.set(id, Date.now());
    this.save();
    return { ...a, unlocked: true, unlockedAt: Date.now() };
  }
}

