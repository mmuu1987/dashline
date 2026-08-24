/**
 * E2E 冒烟：真实模拟一局 → 提交（应通过重放验证）
 *          → 篡改分数再提交（应被 SCORE_MISMATCH 拒绝）
 * 前置：API 已在 :8787 运行。
 */
import { createWorld } from '@dashline/core';
import {
  encodeInputs,
  IN_JUMP_HELD,
  IN_JUMP_PRESS,
  makeInput,
  seedForDate,
  todayUTC,
} from '@dashline/shared';
import { splitmix32 } from '@dashline/shared';

const BASE = 'http://127.0.0.1:8787';

interface AuthRes {
  token: string;
  playerId: string;
  nickname: string;
}

async function postJson(
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function register(tag: string): Promise<AuthRes> {
  const { json } = await postJson('/v1/auth/device', { deviceId: `e2e-${tag}-${Date.now()}` });
  return json as unknown as AuthRes;
}

function simulate(): {
  inputsB64: string;
  score: number;
  finished: boolean;
  timeMs: number;
  distanceM: number;
  coins: number;
} {
  const date = todayUTC();
  const w = createWorld(seedForDate(date));
  const rng = splitmix32(7);
  const inputs: number[] = [];
  while (w.snapshot.alive && !w.snapshot.finished && w.tick < 7200) {
    // 随机跳跳Bot：很快会死在某个障碍上 —— 正好构成一次"未完赛"提交
    let inp = 0;
    if (rng() < 0.06) inp = makeInput(true, true);
    else if (rng() < 0.5) inp = IN_JUMP_HELD;
    w.step(inp);
    inputs.push(inp);
    if (!w.snapshot.alive || w.snapshot.finished) break;
  }
  const s = w.snapshot;
  return {
    inputsB64: encodeInputs(Uint8Array.from(inputs)),
    score: s.score,
    finished: s.finished,
    timeMs: s.timeMs,
    distanceM: s.distanceM,
    coins: s.coinCount,
  };
}

const date = todayUTC();
const run = simulate();
console.log(
  `bot run: alive-ish score=${run.score} dist=${run.distanceM}m time=${run.timeMs}ms finished=${run.finished}`,
);

// ---- 1. 诚实提交：应 202/200 且 status=valid ----
const p1 = await register('honest');
const r1 = await postJson(
  '/v1/runs',
  {
    scope: 'daily',
    date,
    ...run,
    attemptNo: 1,
    clientVersion: 'core.1',
  },
  p1.token,
);
console.log(`[1] honest submit -> HTTP ${r1.status}`, JSON.stringify(r1.json));
if (r1.status >= 300 || r1.json.status !== 'valid') {
  console.error('FAIL: honest run rejected');
  process.exitCode = 1;
}

// ---- 2. 篡改分数：应 422 SCORE_MISMATCH ----
const p2 = await register('tamper');
const r2 = await postJson(
  '/v1/runs',
  {
    scope: 'daily',
    date,
    ...run,
    score: run.score + 12345,
    attemptNo: 1,
    clientVersion: 'core.1',
  },
  p2.token,
);
console.log(`[2] tampered submit -> HTTP ${r2.status}`, JSON.stringify(r2.json));
if (r2.status !== 422 || r2.json.reason !== 'SCORE_MISMATCH') {
  console.error('FAIL: tampered run not rejected properly');
  process.exitCode = 1;
}

console.log('\n✅ E2E 通过：诚实成绩上榜，作弊成绩被确定性重放当场识破。');
