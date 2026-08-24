/**
 * 纹理中心：下载的 CC0 素材（Kenney / Phaser examples）+ canvas 程序化生成的质感贴图。
 * 全部在 boot 时一次性异步加载。
 */
import { Assets, Texture } from 'pixi.js';
import { VIEW_H, VIEW_W } from './consts.js';

export interface GameAssets {
  ground: Texture;
  plank: Texture;
  coin: Texture;
  cloud: Texture;
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

/** 主角滚球：径向渐变球体 + 暗色楔形条纹（让滚动可见）+ 高光 */
function makeBall(): Texture {
  const S = 96;
  return canvasTexture(S, S, (ctx) => {
    const cx = S / 2;
    const r = S / 2 - 4;
    const body = ctx.createRadialGradient(cx - r * 0.35, cx - r * 0.45, r * 0.15, cx, cx, r);
    body.addColorStop(0, '#8fe6ff');
    body.addColorStop(0.55, '#31aae6');
    body.addColorStop(1, '#14609f');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cx, r, 0, Math.PI * 2);
    ctx.fill();
    // 滚动可见的楔形条纹 ×3
    ctx.fillStyle = 'rgba(13,73,128,0.75)';
    for (let k = 0; k < 3; k++) {
      const a0 = (k * 2 * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(cx, cx);
      ctx.arc(cx, cx, r, a0, a0 + 0.62);
      ctx.closePath();
      ctx.fill();
    }
    // 内圈描边
    ctx.strokeStyle = 'rgba(10,40,70,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cx, r - 1.5, 0, Math.PI * 2);
    ctx.stroke();
    // 左上高光
    const hi = ctx.createRadialGradient(cx - r * 0.4, cx - r * 0.5, 1, cx - r * 0.4, cx - r * 0.5, r * 0.5);
    hi.addColorStop(0, 'rgba(255,255,255,0.65)');
    hi.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hi;
    ctx.beginPath();
    ctx.arc(cx - r * 0.4, cx - r * 0.5, r * 0.5, 0, Math.PI * 2);
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

export async function loadAssets(): Promise<GameAssets> {
  const urls = [
    '/assets/ground.png',
    '/assets/plank.png',
    '/assets/coin.png',
    '/assets/cloud.png',
    '/assets/sparkle1.png',
    '/assets/gold.png',
    '/assets/white.png',
    '/assets/p-red.png',
  ] as const;
  const loaded = await Promise.all(urls.map((u) => Assets.load(u)));
  return {
    ground: loaded[0] as Texture,
    plank: loaded[1] as Texture,
    coin: loaded[2] as Texture,
    cloud: loaded[3] as Texture,
    sparkle: loaded[4] as Texture,
    goldDot: loaded[5] as Texture,
    whiteDot: loaded[6] as Texture,
    redTex: loaded[7] as Texture,
    sky: makeSky(),
    vignette: makeVignette(),
    ball: makeBall(),
    glow: makeGlow(),
    spike: makeSpike(34, 26),
    flagCloth: makeFlagCloth(),
    confetti: makeConfetti(),
  };
}
