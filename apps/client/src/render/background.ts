/** 天空渐变（取自素材色）+ 双层森林视差 + 云 —— 静态构建，每帧只位移。 */
import { Container, FillGradient, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { splitmix32 } from '@dashline/shared';
import { VIEW_H, VIEW_W } from './consts.js';
import type { GameAssets } from './textures.js';

interface Cloud {
  s: Sprite;
  speed: number;
}

export class Background {
  readonly root = new Container();

  private far: TilingSprite;
  private near: TilingSprite;
  private clouds: Cloud[] = [];
  private sunGlow: Sprite;
  private t = 0;

  constructor(assets: GameAssets) {
    // 全屏天空渐变：颜色采样自 sky.png 首尾
    const skyG = new Graphics();
    const grad = new FillGradient(0, 0, 0, VIEW_H, {
      type: 'linear',
      colorStops: [
        { offset: 0, color: assets.skyTopColor },
        { offset: 1, color: assets.skyBottomColor },
      ],
    } as never);
    skyG.rect(0, 0, VIEW_W, VIEW_H).fill(grad);
    this.root.addChild(skyG);

    // 太阳：柔光 + 核
    const sunWrap = new Container();
    sunWrap.position.set(VIEW_W * 0.78, 118);
    this.sunGlow = new Sprite(assets.glow);
    this.sunGlow.anchor.set(0.5);
    this.sunGlow.scale.set(3.6);
    this.sunGlow.tint = 0xffd9a0;
    this.sunGlow.alpha = 0.9;
    this.sunGlow.blendMode = 'add';
    const sunCore = new Sprite(assets.glow);
    sunCore.anchor.set(0.5);
    sunCore.scale.set(1.2);
    sunCore.tint = 0xfff2d0;
    sunWrap.addChild(this.sunGlow, sunCore);
    this.root.addChild(sunWrap);

    // 森林层 ×2：远层雾化减速，近层原色提速（tileScale 让 368 高的图对齐视口）
    const scale = VIEW_H / assets.forestLayer.height;
    const mkForest = (tint: number, alpha: number): TilingSprite => {
      const ts = new TilingSprite({
        texture: assets.forestLayer,
        width: VIEW_W + 300,
        height: VIEW_H,
      });
      ts.tileScale.set(scale);
      ts.tint = tint;
      ts.alpha = alpha;
      return ts;
    };
    this.far = mkForest(0x8fa0c8, 0.55); // 远层雾蓝
    this.near = mkForest(0xffffff, 1); // 近层原色
    this.root.addChild(this.far, this.near);

    // 云
    const r = splitmix32(88);
    for (let i = 0; i < 5; i++) {
      const s = new Sprite(assets.cloud);
      s.anchor.set(0.5);
      s.position.set(r() * VIEW_W * 1.6, 40 + r() * 150);
      s.scale.set(0.45 + r() * 0.75);
      s.alpha = 0.38 + r() * 0.35;
      s.tint = 0xf2f6ff;
      this.clouds.push({ s, speed: 7 + r() * 13 });
      this.root.addChild(s);
    }
  }

  update(camX: number, dtSec: number): void {
    this.t += dtSec;
    // 平铺周期 = 纹理宽 × tileScale；速度差制造纵深
    this.far.tilePosition.x = -camX * 0.12;
    this.near.tilePosition.x = -camX * 0.3;
    for (const c of this.clouds) {
      c.s.x -= c.speed * dtSec;
      if (c.s.x < -260) {
        c.s.x = VIEW_W + 240;
        c.s.y = 30 + Math.random() * 160;
      }
    }
    // 太阳呼吸
    this.sunGlow.alpha = 0.78 + Math.sin(this.t * 1.4) * 0.12;
  }
}
