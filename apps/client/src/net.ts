import type { BoardEntry, RunPayload } from '@dashline/shared';

export type { BoardEntry };

/** M0 网络层：全部优雅降级 —— API 不在线就静默进入本地模式，绝不阻塞玩法。 */
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

let online: boolean | null = null;

export async function probeApi(): Promise<boolean> {
  if (online !== null) return online;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1200);
    const res = await fetch(`${API_BASE}/v1/daily/today`, { signal: ctrl.signal });
    clearTimeout(timer);
    online = res.ok;
  } catch {
    online = false;
  }
  return online;
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* 隐私模式等：忽略 */
  }
}

export function deviceId(): string {
  const k = 'dl_device';
  let id = lsGet(k);
  if (!id) {
    id = crypto.randomUUID();
    lsSet(k, id);
  }
  return id;
}

export interface AuthInfo {
  token: string;
  playerId: string;
  nickname?: string;
}

/** 匿名设备注册；失败返回 null（本地模式） */
export async function registerDevice(): Promise<AuthInfo | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/auth/device`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId(), platform: 'web' }),
    });
    if (!res.ok) return null;
    return (await res.json()) as AuthInfo;
  } catch {
    return null;
  }
}

export interface SubmitAck {
  ok: boolean;
  /** 今日计分次数用尽 */
  exhausted?: boolean;
  rank?: number;
  total?: number;
  attemptsLeft?: number;
}

/** 提交成绩（含输入流）；离线/失败返回 ok:false，绝不抛错 */
export async function submitRun(payload: RunPayload, auth: AuthInfo | null): Promise<SubmitAck> {
  if (!auth) return { ok: false };
  try {
    const res = await fetch(`${API_BASE}/v1/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(payload),
    });
    if (res.status === 403) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (j.error === 'ATTEMPTS_EXHAUSTED') return { ok: false, exhausted: true };
    }
    if (!res.ok) return { ok: false };
    const j = (await res.json()) as {
      best?: { rank?: number; total?: number };
      attemptsUsed?: number;
      attemptsMax?: number;
    };
    return {
      ok: true,
      rank: j.best?.rank,
      total: j.best?.total,
      attemptsLeft:
        j.attemptsMax !== undefined && j.attemptsUsed !== undefined
          ? j.attemptsMax - j.attemptsUsed
          : undefined,
    };
  } catch {
    return { ok: false };
  }
}

export async function fetchBoard(date: string): Promise<BoardEntry[] | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/leaderboards/daily/${date}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { entries: BoardEntry[] };
    return data.entries;
  } catch {
    return null;
  }
}

/** 远程 Ghost 供给（每日最快 N 人，含输入流，可直接武装成对手） */
export interface GhostOffer {
  nickname: string;
  timeMs: number;
  score: number;
  inputsB64: string;
}

export async function fetchGhosts(date: string): Promise<GhostOffer[] | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/ghosts/daily/${date}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { ghosts: GhostOffer[] };
    return data.ghosts;
  } catch {
    return null;
  }
}

export { lsGet, lsSet };
