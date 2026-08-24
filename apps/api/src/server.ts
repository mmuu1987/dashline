/**
 * Dashline API —— Fastify + Store 抽象。
 * DATABASE_URL 存在 → PostgreSQL；否则内存态（零依赖开发）。
 * 反作弊：内联调用 @dashline/validator 重放验证。
 */
import cors from '@fastify/cors';
import Fastify from 'fastify';
import {
  nextUtcMidnight,
  seedForDate,
  themeForSeed,
  todayUTC,
  type RunPayload,
} from '@dashline/shared';
import { validateSubmission } from '@dashline/validator';
import { createStore, MAX_SCORED_ATTEMPTS, toStoredRun, type Store } from './store.js';

const PORT = Number(process.env.PORT ?? 8787);

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const store: Store = await createStore(process.env.DATABASE_URL);
app.log.info(`storage backend: ${store.kind}`);

/** token → playerId（会话态，重启后客户端可凭 deviceId 重新换取） */
const tokenOwner = new Map<string, string>();

function newToken(): string {
  return `t-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

// ---------- auth ----------
app.post('/v1/auth/device', async (req, reply) => {
  const b = req.body as { deviceId?: unknown };
  if (typeof b?.deviceId !== 'string' || b.deviceId.length < 8 || b.deviceId.length > 64) {
    return reply.code(422).send({ error: 'VALIDATION_FAILED', reason: 'DEVICE_ID' });
  }
  const { playerId, nickname } = await store.registerDevice(b.deviceId);
  const token = newToken();
  tokenOwner.set(token, playerId);
  return { token, playerId, nickname, streakDays: 1 };
});

function auth(req: { headers: Record<string, unknown> }): string | null {
  const h = req.headers.authorization;
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
  return tokenOwner.get(h.slice(7)) ?? null;
}

// ---------- daily ----------
app.get('/v1/daily/today', async (req) => {
  const date = todayUTC();
  const seed = seedForDate(date);
  // 可选鉴权：带上 token 时返回剩余计分次数
  const playerId = auth(req);
  let attemptsLeft: number | undefined;
  if (playerId) {
    attemptsLeft = Math.max(0, MAX_SCORED_ATTEMPTS - (await store.attemptsUsed(playerId, date)));
  }
  return {
    date,
    seed: seed.toString(),
    themeId: themeForSeed(seed),
    resetAtUtc: nextUtcMidnight(),
    ...(attemptsLeft !== undefined ? { attemptsLeft, attemptsMax: MAX_SCORED_ATTEMPTS } : {}),
  };
});

// ---------- runs ----------
app.post('/v1/runs', async (req, reply) => {
  const playerId = auth(req);
  if (!playerId) return reply.code(401).send({ error: 'AUTH_REQUIRED' });

  const now = Date.now();
  const last = lastSubmitAt.get(playerId) ?? 0;
  if (now - last < 3_000) return reply.code(429).send({ error: 'RATE_LIMITED' });

  const b = req.body as Partial<RunPayload>;
  // L1 廉价校验（100% 内联）
  if (
    b.scope !== 'daily' ||
    typeof b.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
    typeof b.score !== 'number' ||
    !Number.isInteger(b.score) ||
    b.score < 0 ||
    b.score > 10_500_000 ||
    typeof b.timeMs !== 'number' ||
    b.timeMs < 3_000 ||
    b.timeMs > 600_000 ||
    typeof b.distanceM !== 'number' ||
    typeof b.coins !== 'number' ||
    typeof b.inputsB64 !== 'string' ||
    b.inputsB64.length === 0 ||
    b.inputsB64.length > 4096 ||
    typeof b.clientVersion !== 'string'
  ) {
    return reply.code(422).send({ error: 'VALIDATION_FAILED', reason: 'SCHEMA' });
  }

  // 每日计分次数限制
  const used = await store.consumeAttempt(playerId, b.date);
  if (used > MAX_SCORED_ATTEMPTS) {
    return reply.code(403).send({
      error: 'ATTEMPTS_EXHAUSTED',
      attemptsMax: MAX_SCORED_ATTEMPTS,
      message: '今日计分次数已用完，明天再来刷新纪录',
    });
  }

  const seed = seedForDate(b.date);
  // L2 重放验证
  const verdict = validateSubmission(seed, {
    scope: 'daily',
    date: b.date,
    score: b.score!,
    finished: Boolean(b.finished),
    timeMs: b.timeMs!,
    distanceM: b.distanceM!,
    coins: b.coins!,
    attemptNo: b.attemptNo ?? used,
    clientVersion: b.clientVersion!,
    inputsB64: b.inputsB64,
  });
  if (!verdict.ok) {
    app.log.warn({ reason: verdict.reason }, 'run rejected');
    return reply.code(422).send({ error: 'VALIDATION_FAILED', reason: verdict.reason });
  }
  lastSubmitAt.set(playerId, now);

  const p = verdict.replay;
  const improved = await store.saveRun(
    b.date,
    toStoredRun({
      playerId,
      nickname: await storeNickname(playerId),
      score: p.score,
      timeMs: p.timeMs,
      coins: p.coinCount,
      distanceM: p.distanceM,
      finished: p.finished,
      inputsB64: b.inputsB64,
      attemptNo: b.attemptNo ?? used,
      clientVersion: b.clientVersion!,
    }),
  );
  const rank = improved ? await store.rankOf(playerId, b.date) : null;
  return reply.code(improved ? 202 : 200).send({
    runId: `r-${now.toString(36)}`,
    status: 'valid',
    improved,
    best: rank ?? (await store.rankOf(playerId, b.date)),
    attemptsUsed: used,
    attemptsMax: MAX_SCORED_ATTEMPTS,
  });
});

let nicknameCache = new Map<string, string>();
async function storeNickname(playerId: string): Promise<string> {
  const c = nicknameCache.get(playerId);
  if (c) return c;
  const n = await store.nicknameOf(playerId);
  nicknameCache.set(playerId, n);
  return n;
}

const lastSubmitAt = new Map<string, number>();

// ---------- ghosts ----------
app.get('/v1/ghosts/daily/:date', async (req) => {
  const { date } = req.params as { date: string };
  const ghosts = await store.ghostOffers(date, 3);
  return { date, ghosts };
});

// ---------- leaderboards ----------
app.get('/v1/leaderboards/daily/:date', async (req) => {
  const { date } = req.params as { date: string };
  const rows = await store.topRuns(date, 50);
  const entries = rows.map((e, i) => ({
    rank: i + 1,
    playerId: e.playerId,
    nickname: e.nickname,
    score: e.score,
    timeMs: e.finished ? e.timeMs : null,
  }));
  return { date, entries };
});

app.get('/v1/health', async () => ({ ok: true, storage: store.kind }));

process.on('SIGINT', () => void store.close().then(() => process.exit(0)));

await app.listen({ port: PORT, host: '0.0.0.0' });
app.log.info(`Dashline API listening on :${PORT}`);
