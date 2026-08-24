/**
 * 重放验证 —— 反作弊核心。
 * 与客户端 import 同一个 @dashline/core：同 (seed, 输入流) 必须得到同一结果。
 * M0 由 api 内联同步调用；量级上来后切 pg-boss 队列异步消费，接口不变。
 */
import { createWorld } from '@dashline/core';
import { decodeInputs } from '@dashline/shared';
import type { RunPayload } from '@dashline/shared';

export type ReplayResult =
  | {
      ok: true;
      score: number;
      timeMs: number;
      distanceM: number;
      coinCount: number;
      finished: boolean;
      alive: boolean;
      ticks: number;
    }
  | { ok: false; reason: string };

const MAX_TICKS = 3_600_000; // 10 小时上限，防恶意超长流

export function replay(seed: bigint, inputsB64: string): ReplayResult {
  let bytes: Uint8Array;
  try {
    bytes = decodeInputs(inputsB64);
  } catch {
    return { ok: false, reason: 'DECODE_ERROR' };
  }
  if (bytes.length === 0) return { ok: false, reason: 'EMPTY_STREAM' };
  if (bytes.length > MAX_TICKS) return { ok: false, reason: 'STREAM_TOO_LONG' };

  const w = createWorld(seed);
  for (let i = 0; i < bytes.length; i++) {
    w.step(bytes[i]!);
    const s = w.snapshot;
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) {
      return { ok: false, reason: 'SIM_NAN' };
    }
    if (!s.alive || s.finished) break; // 与客户端录制截止点一致
  }
  const s = w.snapshot;
  return {
    ok: true,
    score: s.score,
    timeMs: s.timeMs,
    distanceM: s.distanceM,
    coinCount: s.coinCount,
    finished: s.finished,
    alive: s.alive,
    ticks: s.tick,
  };
}

export type Validation =
  | { ok: true; replay: Extract<ReplayResult, { ok: true }> }
  | { ok: false; reason: string };

/** 完整校验：重放结果与提交声明逐项比对 */
export function validateSubmission(seed: bigint, p: RunPayload): Validation {
  const r = replay(seed, p.inputsB64);
  if (!r.ok) return r;

  if (r.finished !== p.finished) return { ok: false, reason: 'FINISH_MISMATCH' };
  if (r.score !== p.score) return { ok: false, reason: 'SCORE_MISMATCH' };
  if (Math.abs(r.timeMs - p.timeMs) > 2) return { ok: false, reason: 'TIME_MISMATCH' };
  if (r.distanceM !== p.distanceM) return { ok: false, reason: 'DISTANCE_MISMATCH' };
  // 输入流长度必须与声称用时一致（±1 tick 容差）：短流冒充长局直接识破
  const expectTicks = Math.round((p.timeMs * 60) / 1000);
  if (Math.abs(r.ticks - expectTicks) > 1) return { ok: false, reason: 'TICK_TIME_MISMATCH' };
  return { ok: true, replay: r };
}

/** CLI：echo '{"seed":"123","inputsB64":"..."}' | pnpm --filter @dashline/validator cli */
if (process.argv[1]?.endsWith('cli') && typeof process !== 'undefined') {
  let buf = '';
  process.stdin.on('data', (d) => (buf += d));
  process.stdin.on('end', () => {
    try {
      const j = JSON.parse(buf) as { seed: string; inputsB64: string };
      console.log(JSON.stringify(replay(BigInt(j.seed), j.inputsB64), null, 2));
    } catch (e) {
      console.error('bad input', e);
      process.exit(1);
    }
  });
}
