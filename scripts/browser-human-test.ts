/**
 * 真人式浏览器 E2E 自动化测试（Playwright + 真实 Chromium）。
 * 覆盖启动、跑酷结算、重开、本地功能弹窗、暂停恢复与静音状态，
 * 以及两种平台接入场景：宿主桥注入与官方 h5mini-2.0 API（iframe 嵌入自动检测）。
 */
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const SCREENSHOT_DIR = process.env.DASHLINE_SCREENSHOT_DIR
  ? path.resolve(process.env.DASHLINE_SCREENSHOT_DIR)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'dashline-browser-test-'));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function startClient(): ChildProcess {
  const args = ['--filter', '@dashline/client', 'dev', '--port', '5173', '--strictPort'];
  if (process.platform === 'win32') {
    return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }
  return spawn('pnpm', args, { stdio: 'ignore' });
}

async function stopProcess(proc: ChildProcess | null): Promise<void> {
  const pid = proc?.pid;
  if (!pid || proc.exitCode !== null) return;
  if (process.platform !== 'win32') {
    proc.kill('SIGTERM');
    return;
  }
  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('error', () => resolve());
    killer.once('close', () => resolve());
  });
}

async function waitHttp(url: string, timeoutMs = 15_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // 服务仍在启动。
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function requireVisible(page: Page, selector: string, label: string): Promise<void> {
  const locator = page.locator(selector);
  await locator.waitFor({ state: 'visible', timeout: 8_000 });
  assert(await locator.isVisible(), `${label}未显示`);
}

async function runHumanTest(): Promise<void> {
  console.log('=== 启动真人式浏览器自动化交互测试 ===\n');
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  let clientProc: ChildProcess | null = null;
  let browser: Browser | null = null;
  const browserErrors: string[] = [];
  const requestFailures: string[] = [];

  try {
    console.log('[1/6] 正在启动 Vite 单机客户端...');
    clientProc = startClient();
    assert(await waitHttp('http://localhost:5173'), '客户端启动超时');
    console.log('✓ 单机客户端已就绪 (:5173)');

    console.log('[2/6] 正在启动 Chromium 浏览器并打开游戏页面...');
    browser = await chromium.launch({
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
    });
    const context = await browser.newContext({
      viewport: { width: 960, height: 540 },
      deviceScaleFactor: 1,
    });
    await context.addInitScript({
      content: `window.__DASHLINE_PLATFORM__ = {
        init: async () => undefined,
        showRewardedAd: () => new Promise((resolve) => setTimeout(() => resolve('completed'), 600)),
        track: () => undefined
      };`,
    });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        browserErrors.push(`console.${msg.type()}: ${msg.text()}`);
      }
    });
    page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => {
      requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'unknown'}`);
    });

    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await page.locator('html[data-dashline-ready="true"]').waitFor({ timeout: 15_000 });

    console.log('[3/6] 验证 WebGL Canvas 与 HUD 渲染...');
    await requireVisible(page, 'canvas.game-canvas', 'Canvas');
    const metaText = await page.locator('#hud-meta').innerText();
    assert(metaText.trim().length > 0, '初始 HUD 为空');
    assert(metaText.includes('尝试 #1'), `初始尝试次数异常：${metaText}`);
    const bridgePresent = await page.evaluate(() => '__DASHLINE_PLATFORM__' in window);
    const modeText = await page.locator('#hud-mode').innerText();
    assert(modeText.includes('4399'), `平台桥未进入运营模式：${modeText}（bridge=${bridgePresent}）`);
    console.log(`✓ 初始 HUD 状态: "${metaText.replace(/\n/g, ' | ')}"`);

    console.log('[4/6] 模拟真人第 1 局游戏操作...');
    await page.waitForTimeout(500);
    await page.keyboard.press('Space');
    await page.waitForTimeout(700);
    await page.keyboard.down('Space');
    await page.waitForTimeout(280);
    await page.keyboard.up('Space');
    await page.waitForTimeout(1_400);
    const runningStats = await page.locator('#hud-stats').innerText();
    assert(runningStats.includes('📏'), '跑动 HUD 未更新距离');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'human_test_01_running.png') });

    await requireVisible(page, '#result.show', '撞毁结算面板');
    const resultText = await page.locator('#result-panel').innerText();
    assert(resultText.includes('撞毁了'), `未进入预期撞毁结算：${resultText}`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'human_test_02_crash.png') });

    console.log('[5/6] 验证广告等待时重开隔离，以及复活后同局继续...');
    await requireVisible(page, '#btn-revive', '激励广告复活按钮');
    await page.locator('#btn-revive').click();
    await page.locator('#btn-retry').click();
    await page.waitForFunction(() => document.querySelector('#hud-meta')?.textContent?.includes('尝试 #2'));
    await page.waitForTimeout(700);
    assert((await page.locator('#hud-meta').innerText()).includes('尝试 #2'), '旧广告回调污染了新一局');

    await requireVisible(page, '#result.show', '重开后的撞毁结算面板');
    await requireVisible(page, '#btn-revive', '新一局激励广告复活按钮');
    await page.locator('#btn-revive').click();
    await page.locator('#result').waitFor({ state: 'hidden' });
    assert((await page.locator('#hud-meta').innerText()).includes('尝试 #2'), '复活不应增加尝试次数');
    await page.waitForTimeout(2_200);
    await requireVisible(page, '#result.show', '复活后的再次结算面板');
    assert(await page.locator('#btn-revive').count() === 0, '同一局不应出现第二次广告复活入口');
    await page.locator('#btn-retry').click();
    await page.waitForFunction(() => document.querySelector('#hud-meta')?.textContent?.includes('尝试 #3'));
    const round3Meta = await page.locator('#hud-meta').innerText();
    assert(round3Meta.includes('尝试 #3'), `重开后尝试次数异常：${round3Meta}`);

    console.log('[6/6] 验证衣橱、成就、天赋、暂停和音频界面...');
    await page.locator('#btn-wardrobe').click();
    await requireVisible(page, '#result.show', '衣橱面板');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'human_test_05_wardrobe.png') });
    await page.locator('#btn-wclose').click();

    await page.locator('#btn-achievements').click();
    await requireVisible(page, '#result.show', '成就面板');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'human_test_06_achievements.png') });
    await page.locator('#btn-aclose').click();

    await page.locator('#btn-talents').click();
    await requireVisible(page, '#result.show', '天赋面板');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'human_test_07_talents.png') });
    await page.locator('#btn-tclose').click();

    const pauseBtn = page.locator('#btn-pause');
    const pauseBadge = page.locator('#pause-badge');
    await pauseBtn.click();
    await requireVisible(page, '#pause-badge.show', '暂停提示');
    await page.locator('#btn-wardrobe').click();
    await page.locator('#btn-wclose').click();
    assert(await pauseBadge.isVisible(), '从弹窗返回后未保留暂停状态');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'human_test_04_paused.png') });
    await page.keyboard.press('Space');
    await pauseBadge.waitFor({ state: 'hidden' });
    assert(!(await pauseBadge.isVisible()), '空格未恢复游戏');

    const muteBtn = page.locator('#btn-mute');
    const initMute = await muteBtn.innerText();
    await muteBtn.click();
    const afterMute = await muteBtn.innerText();
    assert(initMute !== afterMute, '静音按钮状态未变化');
    await muteBtn.click();

    // ---- 场景 B：官方 h5mini-2.0 API 经 iframe 嵌入时自动接入 ----
    console.log('[官方 SDK 场景] 正在 iframe 宿主中验证 h5api 自动接入...');
    const sdkContext = await browser.newContext({
      viewport: { width: 1000, height: 600 },
      deviceScaleFactor: 1,
    });
    const sdkErrors: string[] = [];
    // 与官方 api.js 契约一致的桩：canPlayAd / playAd(10000→10001) / progress
    await sdkContext.addInitScript({
      content: `window.h5api = {
        progress: function () { window.__h5ProgressCalls = (window.__h5ProgressCalls || 0) + 1; },
        canPlayAd: function (cb) { cb({ canPlayAd: true, remain: 1 }); },
        playAd: function (cb) {
          cb({ code: 10000, message: '开始播放' });
          setTimeout(function () { cb({ code: 10001, message: '播放结束' }); }, 60);
        },
        playInterstitialAd: function () {}
      };`,
    });
    const hostPage = await sdkContext.newPage();
    hostPage.on('pageerror', (error) => sdkErrors.push(`pageerror: ${error.message}`));
    hostPage.on('requestfailed', (request) => {
      requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'unknown'}`);
    });
    const hostHtml =
      '<!doctype html><html><body style="margin:0;background:#222">' +
      '<iframe id="g" src="http://localhost:5173" style="width:960px;height:540px;border:0"></iframe>' +
      '</body></html>';
    await hostPage.setContent(hostHtml, { waitUntil: 'domcontentloaded' });
    let gameFrame = hostPage.frames().find((f) => f.url().includes('localhost:5173'));
    for (let i = 0; i < 20 && !gameFrame; i += 1) {
      await hostPage.waitForTimeout(250);
      gameFrame = hostPage.frames().find((f) => f.url().includes('localhost:5173'));
    }
    assert(gameFrame, `未找到游戏 iframe（frames: ${hostPage.frames().map((f) => f.url()).join(', ')}）`);
    await gameFrame.locator('html[data-dashline-ready="true"]').waitFor({ timeout: 15_000 });

    const sdkModeText = await gameFrame.locator('#hud-mode').innerText();
    assert(sdkModeText.includes('4399'), `iframe 中未进入官方 SDK 运营模式：${sdkModeText}`);
    const progressCalls = await gameFrame.evaluate(
      () => (window as unknown as { __h5ProgressCalls?: number }).__h5ProgressCalls ?? 0,
    );
    assert(progressCalls > 0, '加载进度未上报到平台进度条');

    await gameFrame.locator('#result.show').waitFor({ timeout: 20_000 });
    await gameFrame.locator('#btn-revive').waitFor({ state: 'visible', timeout: 8_000 });
    await hostPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'human_test_08_h5sdk_crash.png') });
    await gameFrame.locator('#btn-revive').click();
    await gameFrame.locator('#result').waitFor({ state: 'hidden', timeout: 8_000 });
    const sdkMeta = await gameFrame.locator('#hud-meta').innerText();
    assert(sdkMeta.includes('尝试 #1'), `官方 SDK 复活不应增加尝试次数：${sdkMeta}`);
    console.log('✓ 官方 h5api 场景：自动检测、进度上报、激励复活全部通过');
    await sdkContext.close();

    assert(browserErrors.length === 0, `浏览器异常：\n${browserErrors.join('\n')}`);
    assert(sdkErrors.length === 0, `官方 SDK 场景浏览器异常：\n${sdkErrors.join('\n')}`);
    assert(requestFailures.length === 0, `资源请求失败：\n${requestFailures.join('\n')}`);
    console.log(`✓ 截图目录: ${SCREENSHOT_DIR}`);
    console.log('🎉 真人式浏览器 E2E 自动化测试全流程成功！');
  } finally {
    if (browser) await browser.close();
    await stopProcess(clientProc);
  }
}

void runHumanTest().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
