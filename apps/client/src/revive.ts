/**
 * 每日免费复活账本。
 * 纯单机数据，只存在 localStorage；按 UTC 日期日切，与每日赛道种子同一时区基准。
 */
import {
  isRecord,
  lsGetFirst,
  lsSet,
  parseStoredJson,
  toNonNegativeInteger,
} from './storage.js';

/** 每日免费复活次数。 */
export const FREE_REVIVES_PER_DAY = 3;

/** 同一局最多用广告复活 1 次，避免刷广告续命。 */
export const AD_REVIVES_PER_RUN = 1;

const reviveKey = 'dl_revives_v1';
const legacyReviveKey = 'dl_revives';

interface ReviveState {
  date: string;
  freeUsed: number;
}

function normalize(raw: string | null, today: string): ReviveState {
  const value = parseStoredJson(raw);
  const fresh: ReviveState = { date: today, freeUsed: 0 };
  if (!isRecord(value)) return fresh;
  // 跨天（或存档损坏）即视为新的一天，重新发放免费次数。
  if (value.date !== today) return fresh;
  return {
    date: today,
    freeUsed: Math.min(FREE_REVIVES_PER_DAY, toNonNegativeInteger(value.freeUsed)),
  };
}

/**
 * 复活机会账本。同一天内免费次数用尽后不再恢复；
 * 广告复活是否可用由平台能力决定，不占用免费额度。
 */
export class ReviveBank {
  private state: ReviveState;

  constructor(private readonly today: string) {
    this.state = normalize(lsGetFirst([reviveKey, legacyReviveKey]), today);
    this.save();
  }

  /** 今日剩余免费复活次数。 */
  remainingFree(): number {
    return Math.max(0, FREE_REVIVES_PER_DAY - this.state.freeUsed);
  }

  /** 今日已用免费复活次数。 */
  usedFree(): number {
    return this.state.freeUsed;
  }

  /** 消耗一次免费复活；额度不足时返回 false 且不改变状态。 */
  consumeFree(): boolean {
    if (this.remainingFree() <= 0) return false;
    this.state.freeUsed += 1;
    this.save();
    return true;
  }

  /** 供调试与测试使用：清空今日记录。 */
  reset(): void {
    this.state = { date: this.today, freeUsed: 0 };
    this.save();
  }

  private save(): void {
    lsSet(reviveKey, JSON.stringify(this.state));
  }
}
