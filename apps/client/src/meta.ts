/**
 * 元游戏（Meta Loop）：连胜（Streak）与近 7 天历史成绩归档。
 * 纯客户端 localStorage 持久化，离线也能追踪个人打卡与进步曲线。
 */
import { lsGet, lsSet } from './net.js';

const KEY_HISTORY = 'dl_history_v1';
const KEY_STREAK = 'dl_streak_v1';

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

export function loadHistory(): HistoryData {
  try {
    const raw = lsGet(KEY_HISTORY);
    if (raw) return JSON.parse(raw) as HistoryData;
  } catch {}
  return { days: {} };
}

export function saveDayRecord(rec: DayRecord): void {
  const h = loadHistory();
  const existing = h.days[rec.date];
  if (!existing || rec.score > existing.score) {
    h.days[rec.date] = rec;
    lsSet(KEY_HISTORY, JSON.stringify(h));
  }
}

/** 计算当前连续打卡天数（Streak） */
export function calculateStreak(todayDateStr: string): number {
  const h = loadHistory();
  const today = new Date(todayDateStr);
  let streak = 0;

  // 从今天或昨天开始往前倒推
  let checkDate = new Date(today);
  const todayKey = checkDate.toISOString().slice(0, 10);

  if (h.days[todayKey]) {
    streak++;
    checkDate.setDate(checkDate.getDate() - 1);
  } else {
    // 今天还没完成，检查昨天
    checkDate.setDate(checkDate.getDate() - 1);
    const yesterdayKey = checkDate.toISOString().slice(0, 10);
    if (!h.days[yesterdayKey]) return 0;
  }

  while (true) {
    const key = checkDate.toISOString().slice(0, 10);
    if (h.days[key]) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
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

