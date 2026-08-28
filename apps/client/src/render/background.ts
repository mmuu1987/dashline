/** 天空渐变（取自素材色）+ 双层森林视差 + 云 —— 静态构建，每帧只位移。 */
import { Container, FillGradient, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { splitmix32 } from '@dashline/shared';
import { VIEW_H, VIEW_W } from './consts.js';
import type { GameAssets } from './textures.js';

export interface ThemePalette {
  name: string;
  skyTop: number;
  skyBottom: number;
  sunTint: number;
  farForestTint: number;
  nearForestTint: number;
  cloudTint: number;
}

export const THEMES: ThemePalette[] = [
  // 0: 晨曦森林 (Sunrise Forest)
  {
    name: '晨曦森林',
    skyTop: 0x131a38,
    skyBottom: 0xd07856,
    sunTint: 0xffd9a0,
    farForestTint: 0x8fa0c8,
    nearForestTint: 0xffffff,
    cloudTint: 0xf2f6ff,
  },
  // 1: 幽邃秘境 (Mystic Night)
  {
    name: '幽邃秘境',
    skyTop: 0x090d1f,
    skyBottom: 0x1f3554,
    sunTint: 0x8fe6ff,
    farForestTint: 0x3d5a80,
    nearForestTint: 0x90e0ef,
    cloudTint: 0xcae9ff,
  },
  // 2: 霓虹赛博 (Neon Cyber)
  {
    name: '霓虹赛博',
    skyTop: 0x180b2b,
    skyBottom: 0x7209b7,
    sunTint: 0xf72585,
    farForestTint: 0x480ca8,
    nearForestTint: 0x4cc9f0,
    cloudTint: 0xf3c4fb,
  },
  // 3: 烈阳荒漠 (Amber Sands)
  {
    name: '烈阳荒漠',
    skyTop: 0x2b1509,
    skyBottom: 0xd97706,
    sunTint: 0xfde68a,
    farForestTint: 0x92400e,
    nearForestTint: 0xf59e0b,
    cloudTint: 0xfef3c7,
  },
  // 4: 翡翠林海 (Emerald Glade)
  {
    name: '翡翠林海',
    skyTop: 0x062818,
    skyBottom: 0x2d6a4f,
    sunTint: 0x95d5b2,
    farForestTint: 0x1b4332,
    nearForestTint: 0x74c69d,
    cloudTint: 0xd8f3dc,
  },
  // 5: 绯红炼狱 (Crimson Dusk)
  {
    name: '绯红炼狱',
    skyTop: 0x240005,
    skyBottom: 0x9d0208,
    sunTint: 0xffba08,
    farForestTint: 0x6a040f,
    nearForestTint: 0xdc2f02,
    cloudTint: 0xffd8d8,
  },
  // 6: 极地冰原 (Glacial Frost)
  {
    name: '极地冰原',
    skyTop: 0x0b1d3a,
    skyBottom: 0x48cae4,
    sunTint: 0xe0fbfc,
    farForestTint: 0x0077b6,
    nearForestTint: 0xade8f4,
    cloudTint: 0xffffff,
  },
  // 7: 暮色极光 (Twilight Aurora)
  {
    name: '暮色极光',
    skyTop: 0x140152,
    skyBottom: 0x028090,
    sunTint: 0x00f5d4,
    farForestTint: 0x22007c,
    nearForestTint: 0x70d6ff,
    cloudTint: 0xe2afff,
  },
];

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
  private skyG = new Graphics();
  private t = 0;

  constructor(private assets: GameAssets, themeId = 0) {
    this.root.addChild(this.skyG);

    // 太阳：柔光 + 核
    const sunWrap = new Container();
    sunWrap.position.set(VIEW_W * 0.78, 118);
    this.sunGlow = new Sprite(assets.glow);
    this.sunGlow.anchor.set(0.5);
    this.sunGlow.scale.set(3.6);
    this.sunGlow.alpha = 0.9;
    this.sunGlow.blendMode = 'add';
    const sunCore = new Sprite(assets.glow);
    sunCore.anchor.set(0.5);
    sunCore.scale.set(1.2);
    sunCore.tint = 0xfff2d0;
    sunWrap.addChild(this.sunGlow, sunCore);
    this.root.addChild(sunWrap);

    // 森林层 ×2
    const scale = VIEW_H / assets.forestLayer.height;
    const mkForest = (): TilingSprite => {
      const ts = new TilingSprite({
        texture: assets.forestLayer,
        width: VIEW_W + 300,
        height: VIEW_H,
      });
      ts.tileScale.set(scale);
      return ts;
    };
    this.far = mkForest();
    this.near = mkForest();
    this.root.addChild(this.far, this.near);

    // 云
    const r = splitmix32(88);
    for (let i = 0; i < 5; i++) {
      const s = new Sprite(assets.cloud);
      s.anchor.set(0.5);
      s.position.set(r() * VIEW_W * 1.6, 40 + r() * 150);
      s.scale.set(0.45 + r() * 0.75);
      s.alpha = 0.38 + r() * 0.35;
      this.clouds.push({ s, speed: 7 + r() * 13 });
      this.root.addChild(s);
    }

    this.applyTheme(themeId);
  }

  applyTheme(themeId: number): void {
    const pal = THEMES[((themeId % THEMES.length) + THEMES.length) % THEMES.length]!;
    this.skyG.clear();
    const grad = new FillGradient(0, 0, 0, VIEW_H, {
      type: 'linear',
      colorStops: [
        { offset: 0, color: pal.skyTop },
        { offset: 1, color: pal.skyBottom },
      ],
    } as never);
    this.skyG.rect(0, 0, VIEW_W, VIEW_H).fill(grad);

    this.sunGlow.tint = pal.sunTint;
    this.far.tint = pal.farForestTint;
    this.far.alpha = 0.55;
    this.near.tint = pal.nearForestTint;
    this.near.alpha = 1;

    for (const c of this.clouds) {
      c.s.tint = pal.cloudTint;
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
