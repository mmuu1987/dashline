/**
 * 战报分享卡：把一局结果合成为 1200×675 社交图片。
 * 视觉沿用 Sunny Land 森林色系（天空渐变取自素材采样色）。
 */
import type { Texture } from 'pixi.js';
import type { GameAssets } from './render/textures.js';

export interface ShareCardData {
  dateStr: string;
  finished: boolean;
  timeMs: number;
  distanceM: number;
  score: number;
  coins: number;
  attempts: number;
}

const W = 1200;
const H = 675;

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function srcOf(t: Texture): CanvasImageSource {
  // Pixi v8：Texture.source.resource 即原始位图/canvas
  return (t.source as unknown as { resource: CanvasImageSource }).resource;
}

export function renderShareCard(assets: GameAssets, d: ShareCardData): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;

  // ---- 背景：天空渐变（素材采样色）----
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, `#${assets.skyTopColor.toString(16).padStart(6, '0')}`);
  grad.addColorStop(1, `#${assets.skyBottomColor.toString(16).padStart(6, '0')}`);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // ---- 底部森林剪影（平铺 + 压暗）----
  const forestSrc = srcOf(assets.forestLayer);
  const fs = H / 368; // forest.png 高 368
  const fw = 176 * fs;
  for (let x = 0; x < W; x += fw) {
    g.globalAlpha = 0.85;
    g.drawImage(forestSrc, x, 0, fw, H);
  }
  g.globalAlpha = 1;
  const shade = g.createLinearGradient(0, H * 0.45, 0, H);
  shade.addColorStop(0, 'rgba(8,12,22,0)');
  shade.addColorStop(1, 'rgba(8,12,22,0.88)');
  g.fillStyle = shade;
  g.fillRect(0, H * 0.45, W, H * 0.55);

  // ---- 草顶地条（底部装饰）----
  const topSrc = srcOf(assets.groundTop);
  for (let x = 0; x < W; x += 64) {
    g.drawImage(topSrc, x, H - 148, 64, 64);
  }

  // ---- 标题与日期 ----
  g.textBaseline = 'middle';
  g.font = '900 44px system-ui, sans-serif';
  g.fillStyle = '#ffffff';
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 10;
  g.fillText('🏁 DASHLINE 每日冲刺', 72, 66);
  g.shadowBlur = 0;
  g.font = '600 28px system-ui, sans-serif';
  const dateW = g.measureText(d.dateStr).width + 36;
  roundRect(g, W - 72 - dateW, 42, dateW, 48, 24);
  g.fillStyle = 'rgba(13,18,32,0.66)';
  g.fill();
  g.fillStyle = '#ffd23f';
  g.textAlign = 'center';
  g.fillText(d.dateStr, W - 72 - dateW / 2, 67);

  // ---- 主面板 ----
  roundRect(g, 72, 140, 640, 400, 28);
  g.fillStyle = 'rgba(11,16,29,0.8)';
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.16)';
  g.lineWidth = 2;
  g.stroke();

  g.textAlign = 'left';
  g.font = '700 30px system-ui, sans-serif';
  g.fillStyle = '#ffd23f';
  g.fillText('今日成绩', 116, 208);

  g.font = '900 128px system-ui, sans-serif';
  g.fillStyle = '#ffffff';
  const big = d.finished ? `${(d.timeMs / 1000).toFixed(2)}s` : `${d.distanceM}m`;
  g.fillText(big, 112, 320);

  g.font = '500 34px system-ui, sans-serif';
  g.fillStyle = '#cdd7ea';
  g.fillText(
    `得分 ${d.score.toLocaleString()}   💎 ${d.coins}   尝试 #${d.attempts}`,
    116,
    420,
  );

  // ---- 右侧主角装饰：光晕 + 球 ----
  const glow = g.createRadialGradient(900, 330, 20, 900, 330, 230);
  glow.addColorStop(0, 'rgba(255,210,63,0.35)');
  glow.addColorStop(1, 'rgba(255,210,63,0)');
  g.fillStyle = glow;
  g.fillRect(650, 100, 520, 460);
  g.save();
  g.translate(900, 330);
  g.rotate(-0.18);
  g.drawImage(srcOf(assets.ball), -110, -110, 220, 220);
  g.restore();
  g.drawImage(srcOf(assets.gemFrames[1]!), 1020, 190, 84, 84);

  // ---- 底部单机模式横幅 ----
  roundRect(g, 0, H - 104, W, 104, 0);
  g.fillStyle = 'rgba(6,9,17,0.82)';
  g.fillRect(0, H - 104, W, 104);
  g.font = '800 38px system-ui, sans-serif';
  g.fillStyle = '#ffffff';
  g.fillText('纯单机 · 每日新赛道', 72, H - 52);
  g.font = '600 30px system-ui, sans-serif';
  g.fillStyle = '#ffd23f';
  g.fillText('挑战今天的自己', 500, H - 52);
  g.font = '500 22px system-ui, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.62)';
  g.textAlign = 'right';
  g.fillText('进度仅保存在本机', W - 60, H - 52);

  return cv;
}

/** 复制到剪贴板；失败则触发下载，返回实际行为 */
export async function exportShareCard(cv: HTMLCanvasElement, filename: string): Promise<'clipboard' | 'download'> {
  try {
    const blob = await new Promise<Blob>((resolve, reject) =>
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
    );
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'clipboard';
  } catch {
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = filename;
    a.click();
    return 'download';
  }
}
