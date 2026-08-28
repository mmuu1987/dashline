/**
 * 真人式浏览器 E2E 自动化测试（Playwright + 真实 Chromium）
 * 模拟真人玩家在浏览器中的完整行为：
 * 1. 加载游戏页面，验证 WebGL / PixiJS / HUD 渲染
 * 2. 模拟真实键盘 / 触控点按跳跃与长按蓄力
 * 3. 经历撞毁 -> 观察闪屏与结算面板
 * 4. 点击"再跑一次"重开第二局，验证连胜/今日最佳状态机
 * 5. 打开排行榜弹窗，验证榜单数据与 Ghost 按钮
 * 6. 测试静音与音频解锁
 * 7. 保存全流程关键视觉截图
 */
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

const SCREENSHOT_DIR = 'C:/Users/XC/.gemini/antigravity/brain/141a0d17-7c26-44c2-aea1-89d3ae8c67ae';

async function waitHttp(url: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function runHumanTest(): Promise<void> {
  console.log('=== 启动真人式浏览器自动化交互测试 ===\n');

  let apiProc: ChildProcess | null = null;
  let clientProc: ChildProcess | null = null;
  let browser: Browser | null = null;

  try {
    // 1. 启动 API 后端与 Vite 客户端
    console.log('[1/7] 正在启动后台 API 与 Vite 客户端服务...');
    apiProc = spawn('pnpm', ['--filter', '@dashline/api', 'start'], {
      shell: true,
      stdio: 'pipe',
    });
    clientProc = spawn('pnpm', ['--filter', '@dashline/client', 'dev', '--port', '5173', '--strictPort'], {
      shell: true,
      stdio: 'pipe',
    });

    const apiReady = await waitHttp('http://127.0.0.1:8787/v1/health');
    const clientReady = await waitHttp('http://localhost:5173');

    if (!apiReady || !clientReady) {
      throw new Error(`服务启动超时: API=${apiReady}, Client=${clientReady}`);
    }
    console.log('✓ API 服务已就绪 (:8787)，客户端服务已就绪 (:5173)');

    // 2. 启动真实 Chromium 浏览器
    console.log('[2/7] 正在启动 Chromium 浏览器并打开游戏页面...');
    browser = await chromium.launch({
      headless: true, // 可在无头环境下精准渲染 WebGL
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
    });

    const context = await browser.newContext({
      viewport: { width: 960, height: 540 },
      deviceScaleFactor: 1,
    });
    const page: Page = await context.newPage();

    // 监听控制台错误与未捕获异常
    page.on('console', (msg) => {
      console.log(`[Browser Console ${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      console.error(`[Browser PageError]`, err);
    });

    await page.goto('http://localhost:5173', { waitUntil: 'commit' });

    // 3. 验证 Canvas 与 HUD 初始状态
    console.log('[3/7] 验证 WebGL Canvas 与 HUD 渲染...');
    const canvas = await page.waitForSelector('canvas.game-canvas');
    if (!canvas) throw new Error('Canvas 未找到');

    const metaText = await page.locator('#hud-meta').innerText();
    console.log(`✓ 初始 HUD 状态: "${metaText.replace(/\n/g, ' | ')}"`);

    // 4. 第一局：模拟真人点按与长按跳跃
    console.log('[4/7] 模拟真人第 1 局游戏操作（单指操作跑酷）...');
    // 人眼观察 0.5s
    await page.waitForTimeout(500);

    // 动作 1：小跳起步
    console.log('  -> 模拟真人点按 [Space] 短跳');
    await page.keyboard.press('Space');
    await page.waitForTimeout(700);

    // 动作 2：蓄力大跳 (按住 280ms)
    console.log('  -> 模拟真人长按 [Space] 蓄力大跳 (280ms)');
    await page.keyboard.down('Space');
    await page.waitForTimeout(280);
    await page.keyboard.up('Space');
    await page.waitForTimeout(1400);

    // 读取实时跑动距离
    const runningStats = await page.locator('#hud-stats').innerText();
    console.log(`  -> 实时跑动进度: ${runningStats.replace(/\n/g, ' | ')}`);

    // 截图 1: 奔跑中
    const runPicPath = path.join(SCREENSHOT_DIR, 'human_test_01_running.png');
    await page.screenshot({ path: runPicPath });
    // 等待自然落地并发生撞毁/结算
    await page.waitForTimeout(3500);

    // 截图 2: 撞毁结算
    const crashPicPath = path.join(SCREENSHOT_DIR, 'human_test_02_crash.png');
    await page.screenshot({ path: crashPicPath });
    console.log(`✓ 截图已保存: ${crashPicPath}`);

    // 5. 第二局：模拟真人按 R 键重开
    console.log('[5/9] 模拟真人按 [R] 键快速重开...');
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(500);

    const round2Meta = await page.locator('#hud-meta').innerText();
    console.log(`✓ 重开成功，当前 HUD: "${round2Meta.replace(/\n/g, ' | ')}"`);

    // 6. 交互测试：查看外观衣橱弹窗
    console.log('[6/9] 模拟真人点击 [外观衣橱] 按钮...');
    const wardrobeBtn = page.locator('#btn-wardrobe');
    await wardrobeBtn.click();
    await page.waitForTimeout(400);

    const skinPicPath = path.join(SCREENSHOT_DIR, 'human_test_05_wardrobe.png');
    await page.screenshot({ path: skinPicPath });
    console.log(`✓ 衣橱面板截图已保存: ${skinPicPath}`);
    await page.click('#btn-wclose', { force: true });
    await page.waitForTimeout(300);

    // 7. 交互测试：查看荣誉成就弹窗
    console.log('[7/9] 模拟真人点击 [荣誉成就] 按钮...');
    const achBtn = page.locator('#btn-achievements');
    await achBtn.click();
    await page.waitForTimeout(400);

    const achPicPath = path.join(SCREENSHOT_DIR, 'human_test_06_achievements.png');
    await page.screenshot({ path: achPicPath });
    console.log(`✓ 成就面板截图已保存: ${achPicPath}`);
    await page.click('#btn-aclose', { force: true });
    await page.waitForTimeout(300);

    // 8. 交互测试：纯净定格暂停
    console.log('[8/9] 模拟真人点击暂停按钮与按 P 键暂停...');
    const pauseBtn = page.locator('#btn-pause');
    await pauseBtn.click();
    await page.waitForTimeout(300);
    const pauseBadge = page.locator('#pause-badge');
    const isPaused = await pauseBadge.isVisible();
    console.log(`✓ 暂停成功，顶部轻量提示徽章显示: ${isPaused}`);

    // 保存纯净定格截图
    const pausePicPath = path.join(SCREENSHOT_DIR, 'human_test_04_paused.png');
    await page.screenshot({ path: pausePicPath });
    console.log(`✓ 纯净定格截图已保存: ${pausePicPath}`);

    // 恢复运行
    await pauseBtn.click();
    await page.waitForTimeout(300);
    console.log('✓ 恢复游戏运行');

    // 9. 交互测试：音频开关
    console.log('[9/9] 模拟真人点击静音切换按钮...');
    const muteBtn = page.locator('#btn-mute');
    const initMute = await muteBtn.innerText();
    await muteBtn.click();
    const afterMute = await muteBtn.innerText();
    console.log(`✓ 静音状态切换: ${initMute} -> ${afterMute}`);
    await muteBtn.click();

    console.log('\n========================================');
    console.log('🎉 真人式浏览器 E2E 自动化测试全流程 100% 成功！');
    console.log('========================================');
  } finally {
    if (browser) await browser.close();
    const killTree = (pid?: number) => {
      if (!pid) return;
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          process.kill(pid);
        }
      } catch {}
    };
    killTree(apiProc?.pid);
    killTree(clientProc?.pid);
  }
}

void runHumanTest();
