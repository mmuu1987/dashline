/** Visual-contract regression. Run against an already started local development server. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const url = process.env.DASHLINE_TEST_URL ?? 'http://127.0.0.1:5173';
const out = resolve(process.env.DASHLINE_SCREENSHOT_DIR ?? 'outputs/art-review');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'] });
const errors: string[] = [];
const checks: string[] = [];
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
try {
  for (const [width, height] of [[1440, 900], [960, 540], [640, 360]]) {
    const page = await browser.newPage({ viewport: { width: width!, height: height! } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    page.on('request', request => { if (new URL(request.url()).origin !== new URL(url).origin) errors.push(`Unexpected external request ${request.url()}`); });
    await page.goto(url);
    await page.locator('html[data-dashline-ready="true"]').waitFor();
    await page.keyboard.press('p');
    const canvas = await page.locator('canvas').boundingBox();
    const hud = await page.locator('#hud').boundingBox();
    assert(canvas && hud && Math.abs(canvas.width - hud.width) < 1 && Math.abs(canvas.height - hud.height) < 1, 'Canvas/HUD sizing mismatch');
    await page.screenshot({ path: resolve(out, `game-${width}.png`) });
    const before = await page.locator('[data-metric="time"]').innerText();
    // Animation-frame barrier, not a fixed sleep: paused HUD must stay unchanged.
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    assert(await page.locator('[data-metric="time"]').innerText() === before, 'Pause changed elapsed time');
    for (const [open, close, name] of [['#btn-wardrobe', '#btn-wclose', 'wardrobe'], ['#btn-achievements', '#btn-aclose', 'achievements'], ['#btn-talents', '#btn-tclose', 'talents']]) {
      await page.locator(open!).click();
      await page.locator('#result.show').waitFor();
      await page.locator('#result-panel img').evaluateAll(async imgs => { await Promise.all(imgs.map(img => (img as HTMLImageElement).decode())); });
      const box = await page.locator('#result-panel').boundingBox();
      assert(box && box.y >= 0 && box.y + box.height <= height! + 1, `${name} panel exceeds viewport`);
      assert(await page.locator('#result-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${name} has horizontal overflow`);
      await page.screenshot({ path: resolve(out, `${name}-${width}.png`) });
      await page.locator(close!).click();
      assert(await page.locator('#pause-badge').isVisible(), 'Modal lost paused state');
    }
    await page.keyboard.press('p');
    await page.locator('#result.show').waitFor({ timeout: 20000 });
    await page.screenshot({ path: resolve(out, `result-${width}.png`) });
    checks.push(`${width}x${height}: startup, local-only requests, pause, wardrobe, achievements, talents, result, layout bounds`);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('html[data-dashline-ready="true"]').waitFor();
  await page.keyboard.press('p');
  // Build isolated visual fixtures from actual code without adding a debug backdoor to the game.
  const card = await page.evaluate(async () => {
    const { loadAssets } = await import('/src/render/textures.ts');
    const { renderShareCard } = await import('/src/share-card.ts');
    const assets = await loadAssets();
    const card = renderShareCard(assets, { dateStr: '2026-09-14', finished: true, timeMs: 99870, distanceM: 1440, score: 5820, coins: 42, attempts: 8 });
    return card.toDataURL('image/png').split(',')[1]!;
  });
  writeFileSync(resolve(out, 'share-card.png'), Buffer.from(card, 'base64'));
  checks.push('Local share-card render: 1200x675');
  // Discover Vite's actual imports instead of hardcoding a drive letter or dependency hash.
  const renderSource = await (await page.request.get(`${url}/src/render.ts`)).text();
  const pixiPath = /from "([^\"]*pixi__js[^\"]*)"/.exec(renderSource)?.[1];
  const corePath = /from "([^\"]*packages\/core\/src\/index.ts[^\"]*)"/.exec(renderSource)?.[1];
  assert(pixiPath && corePath, 'Could not resolve Vite fixture imports');
  const fixtureResult = await page.evaluate(async ({ pixiPath, corePath }) => {
    const { Application } = await import(pixiPath);
    const { createWorld } = await import(corePath);
    const { loadAssets } = await import('/src/render/textures.ts');
    const { GameView } = await import('/src/render.ts');
    const { Wardrobe } = await import('/src/wardrobe.ts');
    const assets = await loadAssets();
    const app = new Application();
    await app.init({ width: 960, height: 540, antialias: true, autoStart: false, preference: 'webgl' });
    const view = new GameView(assets);
    const skins = new Wardrobe().getAllSkins();
    app.stage.addChild(view.root);
    const world = createWorld(20260914n);
    view.setTrack(world.track);
    const points = new Set<number>([0, world.track.finishX]);
    for (const key of ['pads', 'hazards', 'portals', 'shields', 'magnets', 'boosts', 'rings', 'winds', 'gates', 'plats']) {
      for (const item of world.track[key]) points.add(item.x);
    }
    for (const item of world.track.pendulums) points.add(item.x0);
    for (const x of points) {
      view.resetCamera();
      view.sync({ ...world.snapshot, x: Math.max(80, x), tick: 70, grounded: true }, 70 / 60);
      app.render();
    }
    for (let theme = 0; theme < 8; theme++) { view.setTheme(theme); app.render(); }
    for (const skin of skins) {
      view.setSkin(skin);
      for (const state of [{ grounded: true }, { grounded: false }, { dashing: true }, { slamming: true }, { alive: false }, { finished: true }, { hasShield: true, magnetLeft: 80, charge: 1, gravDir: -1 }]) {
        view.sync({ ...world.snapshot, ...state, tick: 60 }, 1);
        app.render();
      }
    }
    view.restoreDynamicState(world.snapshot);
    app.render();
    app.destroy(true, { children: true, texture: false, textureSource: false });
    return { points: points.size, themes: 8, skins: skins.length, statesPerSkin: 7 };
  }, { pixiPath, corePath });
  checks.push(`Isolated render fixtures: ${fixtureResult.points} track points, ${fixtureResult.themes} themes, ${fixtureResult.skins} skins x ${fixtureResult.statesPerSkin} states, restore snapshot`);
  // Check portrait advice on a touch-sized viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'portrait.png') });
  await page.close();
  assert(errors.length === 0, errors.join('\n'));
  writeFileSync(resolve(out, 'checks.json'), JSON.stringify({ passed: true, checks, errors }, null, 2));
  console.log(checks.join('\n'));
  console.log('PASS: no browser errors or remote asset requests');
} finally { await browser.close(); }
