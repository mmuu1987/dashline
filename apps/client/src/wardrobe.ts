/**
 * 外观衣橱系统：
 * 1. 累计金币资产持久化存储与消耗；
 * 2. 4 款高品质萌系角色皮肤与专属拖尾解锁管理；
 * 3. 皮肤即时装备与全局响应。
 */
import {
  isRecord,
  lsGet,
  lsSet,
  parseStoredJson,
  toNonNegativeInteger,
} from './storage.js';

export interface SkinDef {
  id: string;
  name: string;
  desc: string;
  price: number;
  unlocked: boolean;
  primaryColor: number;
  secondaryColor: number;
  earType: 'spirit' | 'fox' | 'cat' | 'mecha';
  trailType: 'streamer' | 'petals' | 'flames' | 'matrix';
}

const DEFAULT_SKINS: Omit<SkinDef, 'unlocked'>[] = [
  {
    id: 'lumina',
    name: '星之灵宝',
    desc: '纯澈天蓝水晶灵光 · 灵动兔耳 · 蓝白流光飘带',
    price: 0,
    primaryColor: 0x38bdf8,
    secondaryColor: 0x0284c7,
    earType: 'spirit',
    trailType: 'streamer',
  },
  {
    id: 'sakura',
    name: '樱粉小狐',
    desc: '软萌樱花粉白渐变 · 灵狐绒耳 · 飘零花瓣尾迹',
    price: 25,
    primaryColor: 0xf472b6,
    secondaryColor: 0xec4899,
    earType: 'fox',
    trailType: 'petals',
  },
  {
    id: 'midnight',
    name: '暗夜幽灵',
    desc: '幽邃深紫星夜结晶 · 软萌猫耳 · 幽蓝鬼火光轨',
    price: 50,
    primaryColor: 0xa855f7,
    secondaryColor: 0x7e22ce,
    earType: 'cat',
    trailType: 'flames',
  },
  {
    id: 'cyber',
    name: '霓虹机甲',
    desc: '高能脉冲赛博金核 · 科技天线 · 电子光子矩阵',
    price: 80,
    primaryColor: 0xfacc15,
    secondaryColor: 0xeab308,
    earType: 'mecha',
    trailType: 'matrix',
  },
];

const STORAGE_KEY = 'dl_wardrobe_v1';
const LEGACY_COINS_KEY = 'dl_total_coins';
const LEGACY_UNLOCKED_KEY = 'dl_unlocked_skins';
const LEGACY_EQUIPPED_KEY = 'dl_equipped_skin';
const VALID_SKIN_IDS = new Set(DEFAULT_SKINS.map((skin) => skin.id));

export class Wardrobe {
  private totalCoins = 0;
  private unlockedIds = new Set<string>(['lumina']);
  private equippedId = 'lumina';

  constructor() {
    this.load();
  }

  private load(): void {
    this.totalCoins = 0;
    this.unlockedIds = new Set(['lumina']);
    this.equippedId = 'lumina';

    const current = parseStoredJson(lsGet(STORAGE_KEY));
    if (isRecord(current)) {
      this.totalCoins = toNonNegativeInteger(current.totalCoins);
      if (Array.isArray(current.unlockedIds)) {
        for (const id of current.unlockedIds) {
          if (typeof id === 'string' && VALID_SKIN_IDS.has(id)) this.unlockedIds.add(id);
        }
      }
      if (
        typeof current.equippedId === 'string' &&
        this.unlockedIds.has(current.equippedId)
      ) {
        this.equippedId = current.equippedId;
      }
      this.save();
      return;
    }

    const legacyCoins = Number.parseInt(lsGet(LEGACY_COINS_KEY) ?? '', 10);
    this.totalCoins = toNonNegativeInteger(legacyCoins);
    const legacyUnlocked = parseStoredJson(lsGet(LEGACY_UNLOCKED_KEY));
    if (Array.isArray(legacyUnlocked)) {
      for (const id of legacyUnlocked) {
        if (typeof id === 'string' && VALID_SKIN_IDS.has(id)) this.unlockedIds.add(id);
      }
    }
    const legacyEquipped = lsGet(LEGACY_EQUIPPED_KEY);
    if (legacyEquipped && this.unlockedIds.has(legacyEquipped)) {
      this.equippedId = legacyEquipped;
    }
    this.save();
  }

  private save(): void {
    lsSet(
      STORAGE_KEY,
      JSON.stringify({
        totalCoins: this.totalCoins,
        unlockedIds: Array.from(this.unlockedIds),
        equippedId: this.equippedId,
      }),
    );
  }

  /** 游玩赚取金币 */
  addCoins(amount: number): number {
    const safeAmount = toNonNegativeInteger(amount);
    if (safeAmount > 0) {
      this.totalCoins = Math.min(Number.MAX_SAFE_INTEGER, this.totalCoins + safeAmount);
      this.save();
    }
    return this.totalCoins;
  }

  /** 扣除金币（用于天赋升级或商城购买） */
  deductCoins(amount: number): boolean {
    if (!Number.isFinite(amount)) return false;
    const safeAmount = toNonNegativeInteger(amount);
    if (safeAmount <= 0) return true;
    if (this.totalCoins < safeAmount) return false;
    this.totalCoins -= safeAmount;
    this.save();
    return true;
  }

  getTotalCoins(): number {
    return this.totalCoins;
  }

  getEquippedSkinId(): string {
    return this.equippedId;
  }

  getEquippedSkin(): SkinDef {
    const list = this.getAllSkins();
    return list.find((s) => s.id === this.equippedId) ?? list[0]!;
  }

  getAllSkins(): SkinDef[] {
    return DEFAULT_SKINS.map((s) => ({
      ...s,
      unlocked: this.unlockedIds.has(s.id),
    }));
  }

  /** 购买或装备皮肤 */
  equipOrBuy(skinId: string): { ok: boolean; msg: string } {
    const skin = DEFAULT_SKINS.find((s) => s.id === skinId);
    if (!skin) return { ok: false, msg: '皮肤不存在' };

    if (this.unlockedIds.has(skinId)) {
      this.equippedId = skinId;
      this.save();
      return { ok: true, msg: `已装备【${skin.name}】` };
    }

    if (this.totalCoins < skin.price) {
      return {
        ok: false,
        msg: `金币不足（需要 🪙 ${skin.price}，当前拥有 🪙 ${this.totalCoins}）`,
      };
    }

    this.totalCoins -= skin.price;
    this.unlockedIds.add(skinId);
    this.equippedId = skinId;
    this.save();
    return { ok: true, msg: `🎉 成功解锁并装备【${skin.name}】！` };
  }
}
