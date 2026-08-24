/** E2E：同一玩家每日计分次数上限（MAX=5，第 6 次应 403 ATTEMPTS_EXHAUSTED） */
import { CORE_VERSION } from '@dashline/shared';
import { solveDaily } from './solve-bot.js';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:8787';
const date = today();
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const reg = await fetch(`${BASE}/v1/auth/device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: `e2e-limit-${Date.now()}` }),
  });
  const auth = (await reg.json()) as { token: string };

  const run = solveDaily();
  if (!run.ok) {
    console.error('solver failed, abort');
    process.exitCode = 1;
    return;
  }

  let exhausted = false;
  for (let i = 1; i <= 6; i++) {
    const res = await fetch(`${BASE}/v1/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({
        scope: 'daily',
        date,
        score: run.score,
        finished: true,
        timeMs: run.timeMs,
        distanceM: run.distanceM,
        coins: run.coins,
        attemptNo: i,
        clientVersion: CORE_VERSION,
        inputsB64: run.inputsB64,
      }),
    });
    const j = (await res.json()) as { error?: string; status?: string };
    console.log(`#${i} -> ${res.status} ${JSON.stringify(j)}`);
    if (res.status === 403 && j.error === 'ATTEMPTS_EXHAUSTED') {
      exhausted = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 3100)); // 避开 3s 频控
  }
  if (!exhausted) {
    console.error('FAIL: 第 6 次提交未被拒绝');
    process.exitCode = 1;
  } else {
    console.log('\n✅ 计分次数限制生效（5 次/日）');
  }
}

void main();
