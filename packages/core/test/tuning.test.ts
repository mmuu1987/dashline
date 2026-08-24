import { describe, expect, it } from 'vitest';
import { SPIKE_W, SPIKE_H } from '../src/chunks.js';
import {
  EDGE_FORGIVE,
  GAP_TIERS,
  holdJumpHeight,
  holdJumpRange,
  holdAirTime,
  tapJumpHeight,
  tapJumpRange,
  tapAirTime,
  effectiveGapNeed,
} from '../src/tuning.js';

/**
 * 调参护栏：任何对 TUNING 的改动都必须满足这些安全边际，
 * 否则可能生成"理论上跳不过去"的赛道。改手感 → 跑这个文件。
 */
describe('调参护栏（tuning guardrails）', () => {
  it('最高档坑也在长按跳能力圈内（≥8% 操作余量）', () => {
    const hardMax = holdJumpRange * GAP_TIERS[2]![1];
    const need = effectiveGapNeed(hardMax);
    expect(need).toBeLessThanOrEqual(holdJumpRange * 0.92);
  });

  it('easy 档坑点按跳也能过（含落点宽容）', () => {
    const easyMax = holdJumpRange * GAP_TIERS[0]![1];
    expect(effectiveGapNeed(easyMax)).toBeLessThanOrEqual(tapJumpRange * 0.95);
  });

  it('点按跳高度落在超休闲"轻快"窗口内（120~200px）', () => {
    expect(tapJumpHeight).toBeGreaterThanOrEqual(120);
    expect(tapJumpHeight).toBeLessThanOrEqual(200);
  });

  it('长按跳明显高于点按跳（操作要有回报，≥1.4x）', () => {
    expect(holdJumpHeight / tapJumpHeight).toBeGreaterThanOrEqual(1.4);
  });

  it('三连尖刺簇可被点按跳轻松越过（水平向）', () => {
    expect(SPIKE_W * 3 + 2 * EDGE_FORGIVE).toBeLessThan(tapJumpRange);
  });

  it('尖刺高度远低于点按跳顶点（不会擦到）', () => {
    expect(SPIKE_H * 2).toBeLessThan(tapJumpHeight);
  });

  it('滞空时间合理：点按 0.6~0.9s，长按 ≤1.1s（空中不可控感上限）', () => {
    expect(tapAirTime).toBeGreaterThanOrEqual(0.6);
    expect(tapAirTime).toBeLessThanOrEqual(0.9);
    expect(holdAirTime).toBeLessThanOrEqual(1.1);
    // 长按距离优势要明显但不夸张
    expect(holdJumpRange / tapJumpRange).toBeGreaterThanOrEqual(1.15);
    expect(holdJumpRange / tapJumpRange).toBeLessThanOrEqual(1.45);
  });
});
