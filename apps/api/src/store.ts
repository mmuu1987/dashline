/**
 * 存储层 —— 路由与存储解耦。
 * - PgStore：PostgreSQL（DATABASE_URL 存在时，docker compose up db 即可）
 * - MemoryStore：零依赖开发态
 *
 * 计次模型：每日前 MAX_SCORED_ATTEMPTS 次有效提交消耗计分次数；
 * attempts 表独立于 runs，避免与"保留最优"逻辑纠缠。
 */
import { CORE_VERSION } from '@dashline/shared';
import type { StoredRun, GhostOfferRow } from './types.js';

export type { StoredRun, GhostOfferRow };

export const MAX_SCORED_ATTEMPTS = 5;

export interface Store {
  readonly kind: 'memory' | 'postgres';
  /** 幂等注册设备 */
  registerDevice(deviceId: string): Promise<{ playerId: string; nickname: string }>;
  nicknameOf(playerId: string): Promise<string>;
  /** 消耗一次计分次数，返回消耗后的已用次数 */
  consumeAttempt(playerId: string, date: string): Promise<number>;
  attemptsUsed(playerId: string, date: string): Promise<number>;
  /** 写入成绩；仅当刷新当日个人最优时返回 true */
  saveRun(date: string, run: StoredRun): Promise<boolean>;
  /** 玩家当日名次与总人数 */
  rankOf(playerId: string, date: string): Promise<{ rank: number; total: number } | null>;
  topRuns(date: string, limit: number): Promise<StoredRun[]>;
  ghostOffers(date: string, limit: number): Promise<GhostOfferRow[]>;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Memory                                                             */
/* ------------------------------------------------------------------ */

export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private devices = new Map<string, string>();
  private nicknames = new Map<string, string>();
  private boards = new Map<string, Map<string, StoredRun>>();
  private attempts = new Map<string, number>();
  private seq = 0;

  async registerDevice(deviceId: string): Promise<{ playerId: string; nickname: string }> {
    const existing = this.devices.get(deviceId);
    if (existing) return { playerId: existing, nickname: this.nicknames.get(existing)! };
    const playerId = `p-${(++this.seq).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const nickname = `跑者${playerId.slice(-4)}`;
    this.devices.set(deviceId, playerId);
    this.nicknames.set(playerId, nickname);
    return { playerId, nickname };
  }

  async nicknameOf(playerId: string): Promise<string> {
    return this.nicknames.get(playerId) ?? '跑者';
  }

  async consumeAttempt(playerId: string, date: string): Promise<number> {
    const k = `${playerId}|${date}`;
    const n = (this.attempts.get(k) ?? 0) + 1;
    this.attempts.set(k, n);
    return n;
  }

  async attemptsUsed(playerId: string, date: string): Promise<number> {
    return this.attempts.get(`${playerId}|${date}`) ?? 0;
  }

  async saveRun(date: string, run: StoredRun): Promise<boolean> {
    let board = this.boards.get(date);
    if (!board) {
      board = new Map();
      this.boards.set(date, board);
    }
    const prev = board.get(run.playerId);
    if (prev && prev.score >= run.score) return false;
    board.set(run.playerId, run);
    return true;
  }

  async rankOf(playerId: string, date: string): Promise<{ rank: number; total: number } | null> {
    const board = this.boards.get(date);
    if (!board || !board.has(playerId)) return null;
    const list = [...board.values()]
      .filter((e) => e.clientVersion === CORE_VERSION)
      .sort((a, z) => z.score - a.score);
    const idx = list.findIndex((e) => e.playerId === playerId);
    if (idx === -1) return null; // 玩家成绩属其他版本桶
    return { rank: idx + 1, total: list.length };
  }

  async topRuns(date: string, limit: number): Promise<StoredRun[]> {
    const board = this.boards.get(date);
    // 版本分桶：只展示与当前 core 同版本的成绩（文档 §排行榜约定）
    return (board ? [...board.values()] : [])
      .filter((e) => e.clientVersion === CORE_VERSION)
      .sort((a, z) => z.score - a.score)
      .slice(0, limit);
  }

  async ghostOffers(date: string, limit: number): Promise<GhostOfferRow[]> {
    return (await this.topRuns(date, 500))
      .filter((e) => e.finished)
      .sort((a, z) => a.timeMs - z.timeMs)
      .slice(0, limit)
      .map((e) => ({
        nickname: e.nickname,
        timeMs: e.timeMs,
        score: e.score,
        inputsB64: e.inputsB64,
      }));
  }

  async close(): Promise<void> {}
}

/* ------------------------------------------------------------------ */
/* Postgres                                                           */
/* ------------------------------------------------------------------ */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,
  device_id   TEXT UNIQUE NOT NULL,
  nickname    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS days (
  date       DATE PRIMARY KEY,
  seed       BIGINT NOT NULL DEFAULT 0,
  theme_id   INT  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS runs (
  id             BIGSERIAL PRIMARY KEY,
  player_id      TEXT NOT NULL REFERENCES players(id),
  day_date       DATE NOT NULL REFERENCES days(date),
  attempt_no     INT  NOT NULL,
  score          INT  NOT NULL,
  finished       BOOLEAN NOT NULL,
  time_ms        INT,
  distance_m     INT,
  coins          INT,
  inputs_b64     TEXT NOT NULL,
  client_version TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'valid',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runs_board ON runs (day_date, status, score DESC);

CREATE TABLE IF NOT EXISTS attempts (
  player_id  TEXT NOT NULL REFERENCES players(id),
  day_date   DATE NOT NULL REFERENCES days(date),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, day_date, created_at)
);
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;

export class PgStore implements Store {
  readonly kind = 'postgres' as const;
  private constructor(private sql: Sql) {}

  static async create(databaseUrl: string): Promise<PgStore> {
    const { default: postgres } = await import('postgres');
    const sql = postgres(databaseUrl, { max: 10, connect_timeout: 5 }) as Sql;
    // 冷启动时 Docker 端口转发可能瞬态抖动，重试几次
    let lastErr: unknown;
    for (let i = 0; i < 5; i++) {
      try {
        await sql.unsafe(SCHEMA);
        return new PgStore(sql);
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    throw lastErr;
  }

  async registerDevice(deviceId: string): Promise<{ playerId: string; nickname: string }> {
    const rows = await this.sql`
      INSERT INTO players (id, device_id, nickname)
      VALUES (
        'p-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
        ${deviceId},
        '跑者' || substr(md5(random()::text), 1, 4)
      )
      ON CONFLICT (device_id) DO UPDATE SET device_id = EXCLUDED.device_id
      RETURNING id, nickname`;
    const r = rows[0]!;
    return { playerId: r.id as string, nickname: r.nickname as string };
  }

  async nicknameOf(playerId: string): Promise<string> {
    const rows = await this.sql`SELECT nickname FROM players WHERE id = ${playerId}`;
    return rows[0] ? (rows[0].nickname as string) : '跑者';
  }

  async consumeAttempt(playerId: string, date: string): Promise<number> {
    await this.sql`
      INSERT INTO days (date) VALUES (${date}::date) ON CONFLICT (date) DO NOTHING`;
    await this.sql`
      INSERT INTO attempts (player_id, day_date)
      VALUES (${playerId}, ${date}::date)`;
    const rows = await this.sql`
      SELECT COUNT(*)::int AS n FROM attempts
      WHERE player_id = ${playerId} AND day_date = ${date}::date`;
    return rows[0]!.n as number;
  }

  async attemptsUsed(playerId: string, date: string): Promise<number> {
    const rows = await this.sql`
      SELECT COUNT(*)::int AS n FROM attempts
      WHERE player_id = ${playerId} AND day_date = ${date}::date`;
    return rows[0]!.n as number;
  }

  async saveRun(date: string, run: StoredRun): Promise<boolean> {
    await this.sql`
      INSERT INTO days (date) VALUES (${date}::date) ON CONFLICT (date) DO NOTHING`;
    const rows = await this.sql`
      INSERT INTO runs (player_id, day_date, attempt_no, score, finished, time_ms, distance_m, coins, inputs_b64, client_version)
      SELECT ${run.playerId}, ${date}::date, ${run.attemptNo}, ${run.score}, ${run.finished},
             ${run.timeMs}, ${run.distanceM}, ${run.coins}, ${run.inputsB64}, ${run.clientVersion}
      WHERE NOT EXISTS (
        SELECT 1 FROM runs
        WHERE player_id = ${run.playerId}
          AND day_date = ${date}::date
          AND status = 'valid'
          AND score >= ${run.score}
      )
      RETURNING id`;
    return rows.length > 0;
  }

  async rankOf(playerId: string, date: string): Promise<{ rank: number; total: number } | null> {
    const rows = await this.sql`
      SELECT rk, total FROM (
        SELECT player_id,
               RANK() OVER (ORDER BY score DESC) AS rk,
               COUNT(*) OVER () AS total
        FROM runs
        WHERE day_date = ${date}::date AND status = 'valid' AND client_version = ${CORE_VERSION}
      ) t WHERE player_id = ${playerId}`;
    return rows[0] ? { rank: Number(rows[0].rk), total: Number(rows[0].total) } : null;
  }

  async topRuns(date: string, limit: number): Promise<StoredRun[]> {
    const rows = await this.sql`
      SELECT r.player_id, p.nickname, r.score, r.time_ms, r.coins, r.distance_m,
             r.finished, r.inputs_b64, r.attempt_no, r.created_at
      FROM runs r JOIN players p ON p.id = r.player_id
      WHERE r.day_date = ${date}::date AND r.status = 'valid' AND r.client_version = ${CORE_VERSION}
      ORDER BY r.score DESC LIMIT ${limit}`;
    return rows.map((r: Record<string, unknown>) => PgStore.rowToRun(r));
  }

  async ghostOffers(date: string, limit: number): Promise<GhostOfferRow[]> {
    const rows = await this.sql`
      SELECT p.nickname, r.time_ms, r.score, r.inputs_b64
      FROM runs r JOIN players p ON p.id = r.player_id
      WHERE r.day_date = ${date}::date AND r.status = 'valid' AND r.finished = true
        AND r.client_version = ${CORE_VERSION}
      ORDER BY r.time_ms ASC LIMIT ${limit}`;
    return rows.map((r: Record<string, unknown>) => ({
      nickname: r.nickname as string,
      timeMs: r.time_ms as number,
      score: r.score as number,
      inputsB64: r.inputs_b64 as string,
    }));
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 1 });
  }

  private static rowToRun(r: Record<string, unknown>): StoredRun {
    return {
      playerId: r.player_id as string,
      nickname: r.nickname as string,
      score: r.score as number,
      timeMs: (r.time_ms as number) ?? 0,
      coins: (r.coins as number) ?? 0,
      distanceM: (r.distance_m as number) ?? 0,
      finished: Boolean(r.finished),
      inputsB64: r.inputs_b64 as string,
      attemptNo: r.attempt_no as number,
      clientVersion: r.client_version as string,
      at: new Date(r.created_at as string).getTime(),
    };
  }
}

/** 工厂：按环境选择实现 */
export async function createStore(databaseUrl: string | undefined): Promise<Store> {
  if (databaseUrl) return PgStore.create(databaseUrl);
  return new MemoryStore();
}

/* 共享行类型（供路由构造 StoredRun） */
export interface NewRunInput {
  playerId: string;
  nickname: string;
  score: number;
  timeMs: number;
  coins: number;
  distanceM: number;
  finished: boolean;
  inputsB64: string;
  attemptNo: number;
  clientVersion: string;
}

export function toStoredRun(i: NewRunInput): StoredRun {
  return {
    playerId: i.playerId,
    nickname: i.nickname,
    score: i.score,
    timeMs: i.timeMs,
    coins: i.coins,
    distanceM: i.distanceM,
    finished: i.finished,
    inputsB64: i.inputsB64,
    attemptNo: i.attemptNo,
    clientVersion: i.clientVersion,
    at: Date.now(),
  };
}
