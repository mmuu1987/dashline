import {
  isRecord,
  lsGetFirst,
  lsSet,
  parseStoredJson,
  toNonNegativeInteger,
} from './storage.js';

export interface BestRecord {
  score: number;
  timeMs: number;
  coins: number;
  distanceM: number;
  finished: boolean;
}

const bestKey = (date: string): string => `dl_best_v1_${date}`;
const legacyBestKey = (date: string): string => `dl_best_${date}`;

function normalizeBestRecord(value: unknown): BestRecord | null {
  if (!isRecord(value)) return null;
  const score = toNonNegativeInteger(value.score, -1);
  if (score < 0) return null;
  return {
    score,
    timeMs: toNonNegativeInteger(value.timeMs),
    coins: toNonNegativeInteger(value.coins),
    distanceM: toNonNegativeInteger(value.distanceM),
    finished: value.finished === true,
  };
}

export function loadBestRecord(date: string): BestRecord | null {
  const record = normalizeBestRecord(
    parseStoredJson(lsGetFirst([bestKey(date), legacyBestKey(date)])),
  );
  if (record) saveBestRecord(date, record);
  return record;
}

export function saveBestRecord(date: string, record: BestRecord): void {
  lsSet(bestKey(date), JSON.stringify(record));
}
