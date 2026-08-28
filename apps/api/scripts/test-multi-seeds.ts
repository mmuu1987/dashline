/**
 * 求解器多种子极限测试套件：
 * 批量抽取 10+ 组不同日期与大随机种子，
 * 验证 Beam Search Solver 在各种不同积木组合（含气流柱、激光闸门、升降台、钉球等）下的 100% 完赛率与重放一致性。
 */
import { validateSubmission } from '@dashline/validator';
import { CORE_VERSION, seedForDate } from '@dashline/shared';
import { solveDaily } from './solve-bot.js';

const TEST_DATES = [
  '2026-08-28', // 今日
  '2026-08-29', // 明日
  '2026-09-01',
  '2026-10-15',
  '2026-12-31',
  '2027-01-01',
  '2027-06-18',
  '2027-11-11',
  '2028-02-29', // 闰年
  '2028-08-08',
];

const CUSTOM_SEEDS: bigint[] = [
  123456789n,
  987654321n,
  1337n,
  42424242n,
  999999999999n,
];

async function runTest(): Promise<void> {
  console.log(`=== 开始多种子求解器压力测试 (CORE_VERSION = ${CORE_VERSION}) ===\n`);
  let passed = 0;
  let total = 0;

  // 1. 日期种子测试
  console.log('--- 测试 10 组全球每日种子 ---');
  for (const date of TEST_DATES) {
    total++;
    const seed = seedForDate(date);
    const start = performance.now();
    const result = solveDaily(seed);
    const costMs = Math.round(performance.now() - start);

    if (!result.ok || !result.finished) {
      console.error(`❌ [FAIL] 日期 ${date} (seed=${seed}) 求解失败!`);
      continue;
    }

    // 校验重放结果
    const validation = validateSubmission(seed, {
      scope: 'daily',
      date,
      score: result.score,
      finished: result.finished,
      timeMs: result.timeMs,
      distanceM: result.distanceM,
      coins: result.coins,
      attemptNo: 1,
      clientVersion: CORE_VERSION,
      inputsB64: result.inputsB64,
    });

    if (!validation.ok) {
      console.error(`❌ [FAIL] 日期 ${date} 重放验证不一致: ${validation.reason}`);
      continue;
    }

    console.log(
      `✓ [PASS] 日期 ${date} | 耗时 ${costMs}ms | 完赛成绩: ${(result.timeMs / 1000).toFixed(2)}s | 分数: ${result.score} | 收集: ${result.coins} 币`,
    );
    passed++;
  }

  // 2. 极端自定义大种子测试
  console.log('\n--- 测试 5 组极端自定义种子 ---');
  for (const seed of CUSTOM_SEEDS) {
    total++;
    const start = performance.now();
    const result = solveDaily(seed);
    const costMs = Math.round(performance.now() - start);

    if (!result.ok || !result.finished) {
      console.error(`❌ [FAIL] 自定义种子 ${seed} 求解失败!`);
      continue;
    }

    const validation = validateSubmission(seed, {
      scope: 'daily',
      date: 'custom',
      score: result.score,
      finished: result.finished,
      timeMs: result.timeMs,
      distanceM: result.distanceM,
      coins: result.coins,
      attemptNo: 1,
      clientVersion: CORE_VERSION,
      inputsB64: result.inputsB64,
    });

    if (!validation.ok) {
      console.error(`❌ [FAIL] 自定义种子 ${seed} 重放验证不一致: ${validation.reason}`);
      continue;
    }

    console.log(
      `✓ [PASS] 种子 ${seed} | 耗时 ${costMs}ms | 完赛成绩: ${(result.timeMs / 1000).toFixed(2)}s | 分数: ${result.score} | 收集: ${result.coins} 币`,
    );
    passed++;
  }

  console.log(`\n=== 测试结果: ${passed} / ${total} 通过 (${((passed / total) * 100).toFixed(1)}%) ===`);
  if (passed !== total) {
    process.exit(1);
  }
}

void runTest();

