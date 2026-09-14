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

// IDs and prices remain stable so existing unlocks/equipped saves remain valid.
const DEFAULT_SKINS: Omit<SkinDef, 'unlocked'>[] = [
  { id: 'lumina', name: '薄荷旅人', desc: '清新薄荷绿，带着好奇心出发。', price: 0, primaryColor: 0x2bc48a, secondaryColor: 0x24845f, earType: 'spirit', trailType: 'streamer' },
  { id: 'sakura', name: '桃桃漫游', desc: '软软桃花粉，把快乐装进口袋。', price: 25, primaryColor: 0xe583a5, secondaryColor: 0xa94f79, earType: 'fox', trailType: 'petals' },
  { id: 'midnight', name: '丁香小梦', desc: '温柔丁香紫，收集沿途的小确幸。', price: 50, primaryColor: 0x9d86c9, secondaryColor: 0x675582, earType: 'cat', trailType: 'flames' },
  { id: 'cyber', name: '奶油阳光', desc: '明亮奶油黄，今天也要元气满满。', price: 80, primaryColor: 0xe6b848, secondaryColor: 0xa77e31, earType: 'mecha', trailType: 'matrix' },
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
