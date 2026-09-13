/**
 * 每日免费复活账本 + 复活检查点追踪。
 * 纯单机数据，只存在 localStorage；按 UTC 日期日切，与每日赛道种子同一时区基准。
 */
import type { World } from '@dashline/core';
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

/**
 * 复活点回溯距离（世界像素）。
 *
 * 320px ≈ 12.8m ≈ 0.9 秒路程：足够看清并处理刚才害死自己的那个坑或尖刺。
 * 检查点必须是"已经跑过去一段路"的旧位置，不能是"当前脚下"：
 * 否则玩家在坑边踩地存点、下一帧掉坑，复活出来就贴着坑口重生，原速再掉一次。
 */
export const REVIVE_BACKOFF_PX = 320;

/** 检查点取样需要的最小模拟状态。 */
export interface GroundedSample {
  alive: boolean;
  grounded: boolean;
  x: number;
}

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

/**
 * 复活检查点追踪器。
 *
 * 只在「踩实地面」时取样，并故意滞后 backoffPx 才提交：提交的那一刻玩家已经又
 * 往前跑了 backoffPx，因此复活点永远落在死亡点身后一段距离，玩家重新拿回完整的
 * 接近距离去处理那个坑或尖刺。
 *
 * 反例（改造前的行为）：当前落地位置直接当检查点 —— 玩家在坑口前 10px 踩地存点、
 * 下一帧掉坑，复活出来就贴着坑沿重生，原速再掉一次，形成"复活即秒死"。
 */
export class ReviveCheckpointTracker {
  private committed: World;
  private pending: World | null = null;
  private pendingX = 0;

  constructor(
    private readonly backoffPx: number,
    spawn: World,
  ) {
    this.committed = spawn;
  }

  /** 每 tick 在跑道运行时调用；只有需要取样时才会真的 clone。 */
  observe(sample: GroundedSample, clone: () => World): void {
    if (!sample.alive || !sample.grounded) return;
    if (this.pending === null) {
      this.pending = clone();
      this.pendingX = sample.x;
      return;
    }
    if (sample.x - this.pendingX >= this.backoffPx) {
      this.committed = this.pending;
      this.pending = null;
    }
  }

  /** 当前可用的复活检查点。 */
  checkpoint(): World {
    return this.committed;
  }

  /** 重开一局：检查点回到出生点，并丢掉未提交的候选。 */
  reset(spawn: World): void {
    this.committed = spawn;
    this.pending = null;
    this.pendingX = 0;
  }
}
