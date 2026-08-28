/**
 * 单机离线天赋强化树系统：
 * 1. 消耗玩家积累的宝石资产升级永久局内被动能力；
 * 2. 4 种强力强化方向：坚毅水晶、磁引力场、点金灵光、破风突进；
 * 3. 驱动 Core 物理层的 PerksConfig。
 */
import type { PerksConfig } from '@dashline/core';

export interface TalentDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  level: number;
  maxLevel: number;
  costs: number[]; // 升级各级所需金币，例如 [25] 或 [15, 30, 60]
  effects: string[]; // 各级效果说明
}

const TALENT_STORAGE_KEY = 'dl_talents';

const INITIAL_TALENTS: Omit<TalentDef, 'level'>[] = [
  {
    id: 'start_shield',
    name: '坚毅水晶',
    desc: '在每一局游戏开局时直接凝聚一层抵御致命伤害的护盾',
    icon: '🛡️',
    maxLevel: 1,
    costs: [25],
    effects: ['开局直接自带 1 层护盾'],
  },
  {
    id: 'magnet_mastery',
    name: '磁引力场',
    desc: '强化磁铁道具的超自然吸引范围与持续效果',
    icon: '🧲',
    maxLevel: 3,
    costs: [15, 30, 60],
    effects: ['磁铁吸附半径 +30%', '磁铁吸附半径 +60%', '磁铁吸附半径 +100%（全屏席卷）'],
  },
  {
    id: 'gem_multiplier',
    name: '点金灵光',
    desc: '拾取赛道宝石时有几率触发神圣共鸣，获得双倍金币收获',
    icon: '💎',
    maxLevel: 3,
    costs: [20, 40, 80],
    effects: ['15% 几率宝石暴击双倍', '25% 几率宝石暴击双倍', '40% 几率宝石暴击双倍'],
  },
  {
    id: 'dash_mastery',
    name: '破风突进',
    desc: '优化空中冲刺的气动流线，延长滞空推进距离',
    icon: '⚡',
    maxLevel: 1,
    costs: [35],
    effects: ['空中冲刺持续距离提升 +50%'],
  },
];

export class Talents {
  private levels: Record<string, number> = {};

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(TALENT_STORAGE_KEY);
      if (raw) {
        this.levels = JSON.parse(raw) as Record<string, number>;
      }
    } catch {
      this.levels = {};
    }
  }

  private save(): void {
    try {
      localStorage.setItem(TALENT_STORAGE_KEY, JSON.stringify(this.levels));
    } catch {
      // ignore
    }
  }

  getAll(): TalentDef[] {
    return INITIAL_TALENTS.map((t) => ({
      ...t,
      level: Math.min(t.maxLevel, Math.max(0, this.levels[t.id] ?? 0)),
    }));
  }

  getLevel(id: string): number {
    return this.levels[id] ?? 0;
  }

  getNextCost(id: string): number | null {
    const def = INITIAL_TALENTS.find((t) => t.id === id);
    if (!def) return null;
    const curLevel = this.getLevel(id);
    if (curLevel >= def.maxLevel) return null; // 已满级
    return def.costs[curLevel] ?? null;
  }

  upgrade(id: string, currentTotalCoins: number): { ok: boolean; cost: number; newLevel: number } {
    const cost = this.getNextCost(id);
    if (cost === null || currentTotalCoins < cost) {
      return { ok: false, cost: cost ?? 0, newLevel: this.getLevel(id) };
    }

    const curLevel = this.getLevel(id);
    const newLevel = curLevel + 1;
    this.levels[id] = newLevel;
    this.save();

    return { ok: true, cost, newLevel };
  }

  getPerksConfig(): PerksConfig {
    const shieldLvl = this.getLevel('start_shield');
    const magnetLvl = this.getLevel('magnet_mastery');
    const gemLvl = this.getLevel('gem_multiplier');
    const dashLvl = this.getLevel('dash_mastery');

    const magnetMult = magnetLvl === 1 ? 1.3 : magnetLvl === 2 ? 1.6 : magnetLvl >= 3 ? 2.0 : 1.0;
    const gemChance = gemLvl === 1 ? 0.15 : gemLvl === 2 ? 0.25 : gemLvl >= 3 ? 0.4 : 0.0;

    return {
      startShield: shieldLvl > 0,
      magnetRadiusMult: magnetMult,
      gemMultiplierChance: gemChance,
      dashBoost: dashLvl > 0,
    };
  }
}
