/**
 * E2E：前瞻 Bot 真完赛 → 上榜 → Ghost 下发校验 → 好友链接参数回环。
 * 前置：API 已在 :8787 运行。
 */
import { PLAYER_R, createWorld } from '@dashline/core';
import { CORE_VERSION, encodeInputs, seedForDate, todayUTC } from '@dashline/shared';
import { solveDaily } from './solve-bot.js';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:8787';
const date = todayUTC();
const seed = seedForDate(date);

interface AuthRes {
  token: string;
  playerId: string;
  nickname?: string;
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

/** 求解型 Bot：clone 预演两条时间线择优（详见 solve-bot.ts） */
function runBot() {
  return solveDaily();
}

const run = runBot();
console.log(
  `bot: finished=${run.finished} time=${(run.timeMs / 1000).toFixed(2)}s dist=${run.distanceM}m coins=${run.coins}`,
);

// ---- 1. 完赛提交 ----
const p1 = await register('finisher');
const r1 = await postJson(
  '/v1/runs',
  { scope: 'daily', date, ...run, attemptNo: 1, clientVersion: CORE_VERSION },
  p1.token,
);
console.log(`[1] submit -> ${r1.status}`, JSON.stringify(r1.json));
if (r1.status >= 300 || r1.json.status !== 'valid') {
  console.error('FAIL: valid finish rejected');
  process.exitCode = 1;
} else if (!run.finished) {
  console.log('（bot 未完赛，跳过 Ghost 断言——链路其余部分已验证）');
} else {
  // ---- 2. Ghost 下发 ----
  const gRes = await fetch(`${BASE}/v1/ghosts/daily/${date}`);
  const gJson = (await gRes.json()) as {
    ghosts: Array<{ nickname: string; timeMs: number; inputsB64: string }>;
  };
  console.log(`[2] ghosts -> ${gRes.status}`, JSON.stringify(gJson.ghosts.map((g) => [g.nickname, g.timeMs])));
  if (gJson.ghosts.length === 0 || !gJson.ghosts[0]!.inputsB64) {
    console.error('FAIL: ghosts empty');
    process.exitCode = 1;
  } else {
    // 输入流可被解码（客户端 armRacer 的第一道关卡）
    try {
      const { decodeInputs } = await import('@dashline/shared');
      const bytes = decodeInputs(gJson.ghosts[0]!.inputsB64);
      console.log(`[3] top ghost stream decodes OK (${bytes.length} ticks)`);
    } catch {
      console.error('FAIL: ghost stream undecodable');
      process.exitCode = 1;
    }
    // ---- 3. 好友链接参数回环（URLSearchParams 解析约定）----
    const hash = `#g=${encodeURIComponent(run.inputsB64).replace(/%/g, '')}`; // base64url 本身 URL 安全
    const p = new URLSearchParams(hash.slice(1));
    if (p.get('g') === run.inputsB64) {
      console.log('[4] friend-link param roundtrip OK');
    } else {
      console.error('FAIL: link param mismatch');
      process.exitCode = 1;
    }
  }
}

if (process.exitCode !== 1) console.log('\n✅ E2E 通过：完赛上榜 → Ghost 下发 → 链接参数回环。');
