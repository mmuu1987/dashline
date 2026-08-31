import { CORE_VERSION } from './constants.js';
import { fnv1a } from './prng.js';

/** UTC 日切日期串 yyyy-mm-dd（每日赛道的统一口径） */
export function todayUTC(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** 日期字符串 → 稳定的大种子（全球同图的关键）。
 *  掺入 CORE_VERSION：赛道生成逻辑升级后同一天自动换图。 */
export function seedForDate(date: string): bigint {
  return BigInt(fnv1a('dashline:' + CORE_VERSION + ':' + date));
}

/** 由种子派生主题 id（视觉轮换用） */
export function themeForSeed(seed: bigint): number {
  return Number(seed % 8n);
}

/** 下一次 UTC 日切的 ISO 时间 */
export function nextUtcMidnight(d: Date = new Date()): string {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + 86_400_000;
  return new Date(t).toISOString();
}
