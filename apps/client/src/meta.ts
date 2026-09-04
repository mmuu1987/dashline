/**
 * 元游戏（Meta Loop）：连续完赛（Streak）与近 7 天历史成绩归档。
 * 纯客户端 localStorage 持久化，离线也能追踪个人打卡与进步曲线。
 */
import {
  isRecord,
  lsGet,
  lsSet,
  parseStoredJson,
  toNonNegativeInteger,
} from './storage.js';

const KEY_HISTORY = 'dl_history_v1';

export interface DayRecord {
  date: string;
  score: number;
  timeMs: number;
  distanceM: number;
  coins: number;
  finished: boolean;
  attempts: number;
  updatedAt: number;
}

export interface HistoryData {
  days: Record<string, DayRecord>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDayRecord(key: string, value: unknown): DayRecord | null {
  if (!DATE_RE.test(key) || !isRecord(value)) return null;
  return {
    date: key,
    score: toNonNegativeInteger(value.score),
    timeMs: toNonNegativeInteger(value.timeMs),
    distanceM: toNonNegativeInteger(value.distanceM),
    coins: toNonNegativeInteger(value.coins),
    finished: value.finished === true,
    attempts: toNonNegativeInteger(value.attempts),
    updatedAt: toNonNegativeInteger(value.updatedAt),
  };
}

export function loadHistory(): HistoryData {
  const parsed = parseStoredJson(lsGet(KEY_HISTORY));
  if (!isRecord(parsed) || !isRecord(parsed.days)) return { days: {} };

  const days: Record<string, DayRecord> = {};
  for (const [key, value] of Object.entries(parsed.days)) {
    const record = normalizeDayRecord(key, value);
    if (record) days[key] = record;
  }
  return { days };
}

export function saveDayRecord(rec: DayRecord): void {
  const h = loadHistory();
  const existing = h.days[rec.date];
  const incoming = normalizeDayRecord(rec.date, rec);
  if (!incoming) return;

  const best = !existing || incoming.score > existing.score ? incoming : existing;
  h.days[rec.date] = {
    ...best,
    finished: Boolean(existing?.finished || incoming.finished),
    attempts: Math.max(existing?.attempts ?? 0, incoming.attempts),
    updatedAt: Math.max(existing?.updatedAt ?? 0, incoming.updatedAt),
  };
  lsSet(KEY_HISTORY, JSON.stringify(h));
}

export function getDayRecord(date: string): DayRecord | null {
  return loadHistory().days[date] ?? null;
}

/** 计算当前连续完赛天数（Streak）。 */
export function calculateStreak(todayDateStr: string): number {
  const h = loadHistory();
  const today = new Date(todayDateStr);
  let streak = 0;

  // 从今天或昨天开始往前倒推
  let checkDate = new Date(today);
  const todayKey = checkDate.toISOString().slice(0, 10);

  if (h.days[todayKey]?.finished) {
    streak++;
    checkDate.setUTCDate(checkDate.getUTCDate() - 1);
  } else {
    // 今天还没完成，检查昨天
    checkDate.setUTCDate(checkDate.getUTCDate() - 1);
    const yesterdayKey = checkDate.toISOString().slice(0, 10);
    if (!h.days[yesterdayKey]?.finished) return 0;
  }

  while (true) {
    const key = checkDate.toISOString().slice(0, 10);
    if (h.days[key]?.finished) {
      streak++;
      checkDate.setUTCDate(checkDate.getUTCDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

/** 获取近 N 天的历史记录列表（按日期正序，用于画图/列表） */
export function getRecentHistory(todayDateStr: string, count = 7): DayRecord[] {
  const h = loadHistory();
  const list: DayRecord[] = [];
  const cur = new Date(todayDateStr);

  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(cur);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (h.days[key]) {
      list.push(h.days[key]!);
    }
  }
  return list;
}
