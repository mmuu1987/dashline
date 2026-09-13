/**
 * 纹理中心：下载的 CC0 素材（Kenney / Phaser examples）+ canvas 程序化生成的质感贴图。
 * 全部在 boot 时一次性异步加载。
 */
import { Assets, Rectangle, Texture } from 'pixi.js';
import { VIEW_H, VIEW_W } from './consts.js';

export interface GameAssets {
  /** 粒子用小贴图（Kenney，线性采样更柔和） */
  sparkle: Texture;
  goldDot: Texture;
  whiteDot: Texture;
  redTex: Texture;
  /** 程序化 ↓ */
  sky: Texture;
  vignette: Texture;
  ball: Texture;
  glow: Texture;
  spike: Texture;
  flagCloth: Texture;
  confetti: Texture;
  fluffyCloud: Texture;
  mountains: Texture;
  /** Sunny Land（ansimuz, BSD-3 repo 编排 / 素材 free-for-commercial）↓ */
  skyTopColor: number;
  skyBottomColor: number;
  forestLayer: Texture;
  /** 草顶条：由 tileset 三种草皮变体横向拼接而成，避免 16px 硬重复 */
  groundTop: Texture;
  groundFill: Texture;
  gemFrames: Texture[];
  bush: Texture;
  rock: Texture;
  platformLong: Texture;
  crate: Texture;
  /** 地面装饰（草簇 / 高草 / 小灌木），取自 tileset 的透明底格子 */
  groundDecor: Texture[];
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  draw(ctx);
  return Texture.from(cv);
}

function makeSky(): Texture {
  return canvasTexture(VIEW_W, VIEW_H + 60, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H + 60);
    g.addColorStop(0, '#131a38');
    g.addColorStop(0.42, '#272e55');
    g.addColorStop(0.72, '#4b3d6e');
    g.addColorStop(0.92, '#a05a54');
    g.addColorStop(1, '#d07856');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H + 60);
    // 星星（固定伪随机，避免每次刷新星空不同）
    let seed = 20250601;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 90; i++) {
      const x = rnd() * VIEW_W;
      const y = rnd() * VIEW_H * 0.52;
      const a = 0.15 + rnd() * 0.6;
      const s = 0.6 + rnd() * 1.7;
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      ctx.fillRect(x, y, s, s);
    }
  });
}

function makeVignette(): Texture {
  return canvasTexture(VIEW_W, VIEW_H, (ctx) => {
    const g = ctx.createRadialGradient(
      VIEW_W / 2,
      VIEW_H / 2,
      Math.min(VIEW_W, VIEW_H) * 0.42,
      VIEW_W / 2,
      VIEW_H / 2,
      Math.max(VIEW_W, VIEW_H) * 0.72,
    );
    g.addColorStop(0, 'rgba(8,10,22,0)');
    g.addColorStop(1, 'rgba(8,10,22,0.52)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  });
}

/** 主角滚球：晶莹剔透的水晶精灵球体 + 柔和光纹（滚动平滑可见）+ 弧形高光与内发光 */
function makeBall(): Texture {
  const S = 96;
  return canvasTexture(S, S, (ctx) => {
    const cx = S / 2;
    const r = S / 2 - 4;

    // 1. 底色柔和外发光
    const outerGlow = ctx.createRadialGradient(cx, cx, r * 0.7, cx, cx, r + 3);
    outerGlow.addColorStop(0, 'rgba(56,189,248,0.4)');
    outerGlow.addColorStop(1, 'rgba(56,189,248,0)');
    ctx.fillStyle = outerGlow;
    ctx.beginPath();
    ctx.arc(cx, cx, r + 3, 0, Math.PI * 2);
    ctx.fill();

    // 2. 水晶球体多层渐变（透亮天蓝与深邃海蓝）
    const body = ctx.createRadialGradient(cx - r * 0.35, cx - r * 0.35, r * 0.1, cx, cx, r);
    body.addColorStop(0, '#e0f2fe');
    body.addColorStop(0.35, '#38bdf8');
    body.addColorStop(0.75, '#0284c7');
    body.addColorStop(1, '#0369a1');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cx, r, 0, Math.PI * 2);
    ctx.fill();

    // 3. 晶莹微光符纹（轻盈柔和的螺旋光纹，旋转时优雅平滑）
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (let k = 0; k < 3; k++) {
      const a0 = (k * 2 * Math.PI) / 3;
      ctx.beginPath();
      ctx.arc(cx, cx, r * 0.82, a0, a0 + 0.45);
      ctx.arc(cx, cx, r * 0.45, a0 + 0.45, a0, true);
      ctx.closePath();
      ctx.fill();
    }

    // 4. 精细水晶边缘描边
    ctx.strokeStyle = 'rgba(2,132,199,0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cx, r - 1, 0, Math.PI * 2);
    ctx.stroke();

    // 5. 顶层主高光（弧形玻璃质感）
    const hi = ctx.createRadialGradient(cx - r * 0.32, cx - r * 0.38, 2, cx - r * 0.32, cx - r * 0.38, r * 0.42);
    hi.addColorStop(0, 'rgba(255,255,255,0.95)');
    hi.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    hi.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hi;
    ctx.beginPath();
    ctx.arc(cx - r * 0.32, cx - r * 0.38, r * 0.42, 0, Math.PI * 2);
    ctx.fill();

    // 6. 底部柔和反光（地面环境光）
    const rim = ctx.createRadialGradient(cx + r * 0.25, cx + r * 0.4, r * 0.05, cx + r * 0.25, cx + r * 0.4, r * 0.45);
    rim.addColorStop(0, 'rgba(125,211,252,0.6)');
    rim.addColorStop(1, 'rgba(125,211,252,0)');
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(cx, cx, r - 1.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function makeGlow(): Texture {
  const S = 128;
  return canvasTexture(S, S, (ctx) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  });
}

/** 金属感尖刺：线性渐变 + 描边 + 左缘高光 */
function makeSpike(w: number, h: number): Texture {
  return canvasTexture(w, h, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#aab6c8');
    g.addColorStop(0.45, '#77879c');
    g.addColorStop(1, '#49566a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(1, h);
    ctx.lineTo(w / 2, 1);
    ctx.lineTo(w - 1, h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#232c3c';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(3.5, h - 2);
    ctx.lineTo(w / 2, 4);
    ctx.stroke();
  });
}

/** 格子旗 */
function makeFlagCloth(): Texture {
  return canvasTexture(58, 40, (ctx) => {
    const cw = 58 / 4;
    const ch = 40 / 3;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#1b2130' : '#f2f5fb';
        ctx.fillRect(col * cw, row * ch, cw, ch);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 56, 38);
  });
}

function makeConfetti(): Texture {
  return canvasTexture(10, 14, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(0, 0, 10, 14, 3);
    ctx.fill();
  });
}

/** 柔美高空积云（多球渐变羽化融合） */
function makeFluffyCloud(): Texture {
  const W = 360;
  const H = 140;
  return canvasTexture(W, H, (ctx) => {
    const blobs = [
      { x: 80, y: 90, r: 42 },
      { x: 135, y: 70, r: 54 },
      { x: 195, y: 58, r: 62 },
      { x: 255, y: 74, r: 48 },
      { x: 295, y: 92, r: 36 },
      { x: 180, y: 92, r: 44 },
    ];
    for (const b of blobs) {
      const g = ctx.createRadialGradient(b.x, b.y - b.r * 0.15, b.r * 0.1, b.x, b.y, b.r);
      g.addColorStop(0, 'rgba(255,255,255,0.92)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.6)');
      g.addColorStop(0.85, 'rgba(255,255,255,0.18)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** 远山连绵山峦纹理（连绵起伏的山脉剪影） */
function makeDistantMountains(): Texture {
  const W = 1200;
  const H = 260;
  return canvasTexture(W, H, (ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.7)');
    grad.addColorStop(0.75, 'rgba(255,255,255,0.3)');
    grad.addColorStop(1, 'rgba(255,255,255,0.05)');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(0, H);
    const peaks = [
      { x: 0, y: 140 },
      { x: 130, y: 70 },
      { x: 250, y: 125 },
      { x: 410, y: 35 },
      { x: 570, y: 120 },
      { x: 730, y: 55 },
      { x: 900, y: 135 },
      { x: 1050, y: 65 },
      { x: 1200, y: 140 },
    ];
    for (let i = 0; i < peaks.length - 1; i++) {
      const p0 = peaks[i]!;
      const p1 = peaks[i + 1]!;
      const cx = (p0.x + p1.x) / 2;
      ctx.quadraticCurveTo(p0.x + (p1.x - p0.x) * 0.35, p0.y, cx, (p0.y + p1.y) / 2);
      ctx.quadraticCurveTo(p0.x + (p1.x - p0.x) * 0.65, p1.y, p1.x, p1.y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  });
}

/** 像素素材必须用最近邻采样，否则线性插值会把像素质感糊掉。 */
function useNearest(tex: Texture): Texture {
  tex.source.scaleMode = 'nearest';
  return tex;
}

/** 取 tileset 的单个 16px 格子作为独立纹理（共享同一张图集）。 */
function tileFrame(tileset: Texture, col: number, row: number): Texture {
  const size = 16;
  return new Texture({
    source: tileset.source,
    frame: new Rectangle(col * size, row * size, size, size),
  });
}

/** 把若干等宽格子在 canvas 上横向拼成一条，供 TilingSprite 平铺以获得变体。 */
function composeStrip(parts: readonly Texture[]): Texture {
  const first = parts[0]!;
  const w = first.frame.width;
  const h = first.frame.height;
  const cv = document.createElement('canvas');
  cv.width = w * parts.length;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  parts.forEach((p, i) => {
    const src = p.source.resource as CanvasImageSource;
    ctx.drawImage(src, p.frame.x, p.frame.y, w, h, i * w, 0, w, h);
  });
  return useNearest(Texture.from(cv));
}

/** 资源 URL：拼上构建 base（dev='/'，Pages 子路径='./'），兼容任意部署目录 */
const assetUrl = (p: string): string => import.meta.env.BASE_URL + p.replace(/^\//, '');

/** 参与最近邻采样的像素素材（Sunny Land 手绘像素画）。 */
const PIXEL_ART = [
  'assets/art/forest.png',
  'assets/art/gem-1.png',
  'assets/art/gem-2.png',
  'assets/art/gem-3.png',
  'assets/art/gem-4.png',
  'assets/art/bush.png',
  'assets/art/rock.png',
  'assets/art/platform_long.png',
  'assets/art/crate.png',
  'assets/art/tileset.png',
] as const;

/** 只加载渲染真正用到的资源；粒子贴图 4 张 + 像素素材。 */
const ASSET_URLS = [
  'assets/sparkle1.png',
  'assets/gold.png',
  'assets/white.png',
  'assets/p-red.png',
  ...PIXEL_ART,
] as const;

/** 加载图片位图，并采样顶部/底部主色（供全屏天空渐变） */
async function loadBitmap(url: string): Promise<{ bmp: ImageBitmap; top: number; bottom: number }> {
  const res = await fetch(assetUrl(url));
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas');
  cv.width = 1;
  cv.height = 2;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, 1, 2);
  const px = ctx.getImageData(0, 0, 1, 2).data;
  const toHex = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;
  return { bmp, top: toHex(px[0]!, px[1]!, px[2]!), bottom: toHex(px[4]!, px[5]!, px[6]!) };
}

export async function loadAssets(
  onProgress?: (done: number, total: number) => void,
): Promise<GameAssets> {
  // 进度总量包含天空位图的二次读取，保证 100% 对应全部资源就绪
  const total = ASSET_URLS.length + 1;
  let done = 0;
  const loaded = new Map<string, Texture>();
  try {
    await Promise.all(
      ASSET_URLS.map((u) =>
        Assets.load(assetUrl(u)).then((tex: Texture) => {
          loaded.set(u, tex);
          done += 1;
          onProgress?.(done, total);
          return tex;
        }),
      ),
    );
  } catch (error) {
    throw new Error('游戏资源加载失败，请检查网络或刷新页面重试', { cause: error });
  }
  const tex = (u: (typeof ASSET_URLS)[number]): Texture => loaded.get(u)!;

  // 像素画一律最近邻采样
  for (const u of PIXEL_ART) useNearest(tex(u));

  // 天空主色采样：只需要颜色，位图用完即释放
  let skyTopColor = 0x1976d2;
  let skyBottomColor = 0xe3f2fd;
  try {
    const skyBmp = await loadBitmap('assets/art/sky.png');
    skyTopColor = skyBmp.top;
    skyBottomColor = skyBmp.bottom;
    skyBmp.bmp.close();
  } catch (error) {
    throw new Error('天空资源读取失败，请刷新页面重试', { cause: error });
  }
  done += 1;
  onProgress?.(done, total);

  const tileset = tex('assets/art/tileset.png');
  const gemFrames = [
    tex('assets/art/gem-1.png'),
    tex('assets/art/gem-2.png'),
    tex('assets/art/gem-3.png'),
    tex('assets/art/gem-4.png'),
  ];

  return {
    sparkle: tex('assets/sparkle1.png'),
    goldDot: tex('assets/gold.png'),
    whiteDot: tex('assets/white.png'),
    redTex: tex('assets/p-red.png'),
    sky: makeSky(),
    vignette: makeVignette(),
    ball: makeBall(),
    glow: makeGlow(),
    spike: makeSpike(34, 26),
    flagCloth: makeFlagCloth(),
    confetti: makeConfetti(),
    fluffyCloud: makeFluffyCloud(),
    mountains: makeDistantMountains(),
    skyTopColor,
    skyBottomColor,
    forestLayer: tex('assets/art/forest.png'),
    // tileset 第一行有三块草皮变体，拼成 48×16 一条再平铺，避免同 16px 图案硬重复
    groundTop: composeStrip([
      tileFrame(tileset, 1, 1),
      tileFrame(tileset, 3, 1),
      tileFrame(tileset, 5, 1),
    ]),
    // 泥土填充同理：第三行三块无草皮的土块变体
    groundFill: composeStrip([
      tileFrame(tileset, 1, 3),
      tileFrame(tileset, 5, 3),
      tileFrame(tileset, 7, 3),
    ]),
    gemFrames,
    bush: tex('assets/art/bush.png'),
    rock: tex('assets/art/rock.png'),
    platformLong: tex('assets/art/platform_long.png'),
    crate: tex('assets/art/crate.png'),
    groundDecor: [
      tileFrame(tileset, 1, 7), // 圆草簇
      tileFrame(tileset, 3, 7), // 高草
      tileFrame(tileset, 9, 7), // 小灌木
      tileFrame(tileset, 11, 7), // 小灌木（变体）
    ],
  };
}
