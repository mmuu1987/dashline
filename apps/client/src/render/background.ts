/**
 * 高级环境背景渲染系统：
 * 1. 3色阶明澈天空渐变 + 昼夜星空粒子
 * 2. 太阳/月亮柔光晕染与天体呼吸
 * 3. 高空轻盈流云（纯净高位 y: 25~100px、独立视差与时间飘移，绝不遮挡地面与树林）
 * 4. 连绵起伏的远山天际线（Distant Mountains）
 * 5. 双层森林纵深视差（远景柔光雾林 / 近景原色葱郁林冠，保留全部树叶手绘细节）
 * 6. 8 套高纯度、高对比度、通透清爽的现代独立游戏配色系统（绝无沉浊土黄与黑斑）
 */
import { Container, FillGradient, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { GROUND_Y } from '@dashline/core';
import { splitmix32 } from '@dashline/shared';
import { VIEW_H, VIEW_W } from './consts.js';
import type { GameAssets } from './textures.js';

export interface ThemePalette {
  name: string;
  skyTop: number;
  skyMid: number;
  skyBottom: number;
  sunTint: number;
  sunAlpha: number;
  mountainTint: number;
  mountainAlpha: number;
  farForestTint: number;
  farForestAlpha: number;
  nearForestTint: number;
  nearForestAlpha: number;
  cloudTint: number;
  cloudAlpha: number;
  showStars: boolean;
}

export const THEMES: ThemePalette[] = [
  // 0: 蔚蓝晴空 (Azure Daylight) - 明亮通透、蓝天白云、翠绿森林
  {
    name: '蔚蓝晴空',
    skyTop: 0x1976d2,
    skyMid: 0x64b5f6,
    skyBottom: 0xe3f2fd,
    sunTint: 0xfff176,
    sunAlpha: 0.95,
    mountainTint: 0x7986cb,
    mountainAlpha: 0.55,
    farForestTint: 0x81c784,
    farForestAlpha: 0.65,
    nearForestTint: 0xffffff,
    nearForestAlpha: 1.0,
    cloudTint: 0xffffff,
    cloudAlpha: 0.85,
    showStars: false,
  },
  // 1: 暮光幻霞 (Sunset Glow) - 瑰丽晚霞玫瑰紫与落日金
  {
    name: '暮光幻霞',
    skyTop: 0x2e1065,
    skyMid: 0x9333ea,
    skyBottom: 0xfb923c,
    sunTint: 0xfde047,
    sunAlpha: 0.95,
    mountainTint: 0x581c87,
    mountainAlpha: 0.6,
    farForestTint: 0xc084fc,
    farForestAlpha: 0.65,
    nearForestTint: 0xf3e8ff,
    nearForestAlpha: 0.95,
    cloudTint: 0xffedd5,
    cloudAlpha: 0.75,
    showStars: true,
  },
  // 2: 极地冰川 (Glacial Ice) - 清冽透亮的海蓝与冰雪水晶
  {
    name: '极地冰川',
    skyTop: 0x075985,
    skyMid: 0x38bdf8,
    skyBottom: 0xe0f2fe,
    sunTint: 0xf0fdfa,
    sunAlpha: 0.95,
    mountainTint: 0x0284c7,
    mountainAlpha: 0.5,
    farForestTint: 0x67e8f9,
    farForestAlpha: 0.6,
    nearForestTint: 0xccfbf1,
    nearForestAlpha: 1.0,
    cloudTint: 0xffffff,
    cloudAlpha: 0.85,
    showStars: false,
  },
  // 3: 晨曦破晓 (Dawn Aurora) - 晨露柔粉与第一缕金芒
  {
    name: '晨曦破晓',
    skyTop: 0x3b0764,
    skyMid: 0xc026d3,
    skyBottom: 0xfef08a,
    sunTint: 0xfef9c3,
    sunAlpha: 0.95,
    mountainTint: 0x701a75,
    mountainAlpha: 0.55,
    farForestTint: 0xf472b6,
    farForestAlpha: 0.6,
    nearForestTint: 0xffedd5,
    nearForestAlpha: 0.95,
    cloudTint: 0xffffff,
    cloudAlpha: 0.8,
    showStars: true,
  },
  // 4: 翡翠幽谷 (Emerald Forest) - 吉卜力般的清爽深林与薄荷微风
  {
    name: '翡翠幽谷',
    skyTop: 0x064e3b,
    skyMid: 0x10b981,
    skyBottom: 0xd1fae5,
    sunTint: 0xfef08a,
    sunAlpha: 0.92,
    mountainTint: 0x047857,
    mountainAlpha: 0.5,
    farForestTint: 0x6ee7b7,
    farForestAlpha: 0.65,
    nearForestTint: 0xffffff,
    nearForestAlpha: 1.0,
    cloudTint: 0xf0fdf4,
    cloudAlpha: 0.8,
    showStars: false,
  },
  // 5: 赛博霓虹 (Cyber Synthwave) - 电子脉冲紫与霓虹粉
  {
    name: '赛博霓虹',
    skyTop: 0x180033,
    skyMid: 0x8b00ff,
    skyBottom: 0xff0099,
    sunTint: 0x00ffff,
    sunAlpha: 0.95,
    mountainTint: 0x550088,
    mountainAlpha: 0.6,
    farForestTint: 0xd946ef,
    farForestAlpha: 0.65,
    nearForestTint: 0xfae8ff,
    nearForestAlpha: 0.95,
    cloudTint: 0xf5d0fe,
    cloudAlpha: 0.65,
    showStars: true,
  },
  // 6: 银河星海 (Cosmic Night) - 浩瀚深空与皎洁月辉
  {
    name: '银河星海',
    skyTop: 0x030712,
    skyMid: 0x1e293b,
    skyBottom: 0x60a5fa,
    sunTint: 0xf8fafc,
    sunAlpha: 0.95,
    mountainTint: 0x1e3a8a,
    mountainAlpha: 0.55,
    farForestTint: 0x93c5fd,
    farForestAlpha: 0.6,
    nearForestTint: 0xdbeafe,
    nearForestAlpha: 0.95,
    cloudTint: 0xe2e8f0,
    cloudAlpha: 0.65,
    showStars: true,
  },
  // 7: 幽境极光 (Boreal Aurora) - 极光翡翠碧玺与流光夜
  {
    name: '幽境极光',
    skyTop: 0x022c22,
    skyMid: 0x0d9488,
    skyBottom: 0x5eead4,
    sunTint: 0x99f6e4,
    sunAlpha: 0.95,
    mountainTint: 0x134e4a,
    mountainAlpha: 0.55,
    farForestTint: 0x2dd4bf,
    farForestAlpha: 0.65,
    nearForestTint: 0xccfbf1,
    nearForestAlpha: 0.95,
    cloudTint: 0xf0fdfa,
    cloudAlpha: 0.75,
    showStars: true,
  },
];

interface CloudItem {
  s: Sprite;
  baseX: number;
  y: number;
  driftSpeed: number;
  driftX: number;
}

export class Background {
  readonly root = new Container();

  private skyG = new Graphics();
  private starsWrap = new Container();
  private sunWrap = new Container();
  private sunGlow: Sprite;
  private sunCore: Sprite;
  private cloudsWrap = new Container();
  private clouds: CloudItem[] = [];
  private mountains: TilingSprite;
  private far: TilingSprite;
  private near: TilingSprite;
  private t = 0;

  constructor(private assets: GameAssets, themeId = 0) {
    // 1. 全屏 3 阶明亮渐变天空
    this.root.addChild(this.skyG);

    // 2. 星空层（夜景/暮光时显示）
    const rStar = splitmix32(1024);
    const starG = new Graphics();
    for (let i = 0; i < 70; i++) {
      const sx = rStar() * VIEW_W;
      const sy = rStar() * VIEW_H * 0.42;
      const sa = 0.25 + rStar() * 0.7;
      const sz = 1.2 + rStar() * 1.5;
      starG.rect(sx, sy, sz, sz).fill({ color: 0xffffff, alpha: sa });
    }
    this.starsWrap.addChild(starG);
    this.root.addChild(this.starsWrap);

    // 3. 天体（太阳 / 月亮）：多层柔光核
    this.sunWrap.position.set(VIEW_W * 0.78, 105);
    this.sunGlow = new Sprite(assets.glow);
    this.sunGlow.anchor.set(0.5);
    this.sunGlow.scale.set(3.8);
    this.sunGlow.blendMode = 'add';

    this.sunCore = new Sprite(assets.glow);
    this.sunCore.anchor.set(0.5);
    this.sunCore.scale.set(1.3);
    this.sunCore.blendMode = 'add';

    this.sunWrap.addChild(this.sunGlow, this.sunCore);
    this.root.addChild(this.sunWrap);

    // 4. 高空流云（置于天体之后、远山之前，严格处于 y: 25~95px 高空，绝不遮挡地面跑道）
    const rCloud = splitmix32(777);
    for (let i = 0; i < 4; i++) {
      const s = new Sprite(assets.fluffyCloud);
      s.anchor.set(0.5);
      const y = 30 + rCloud() * 65;
      const baseX = rCloud() * (VIEW_W + 400);
      s.scale.set(0.55 + rCloud() * 0.4);
      s.alpha = 0.8;
      this.clouds.push({
        s,
        baseX,
        y,
        driftSpeed: 5 + rCloud() * 9,
        driftX: 0,
      });
      this.cloudsWrap.addChild(s);
    }
    this.root.addChild(this.cloudsWrap);

    // 5. 远山天际线（Distant Mountains）
    this.mountains = new TilingSprite({
      texture: assets.mountains,
      width: VIEW_W + 400,
      height: 240,
    });
    this.mountains.position.set(0, GROUND_Y - 240);
    this.root.addChild(this.mountains);

    // 6. 远景森林（柔和雾化）与近景森林（原色葱郁树冠）
    // scale 适配让树冠自然展现在中景地平线
    const fHeight = 220;
    const scale = fHeight / assets.forestLayer.height;
    const mkForest = (posY: number): TilingSprite => {
      const ts = new TilingSprite({
        texture: assets.forestLayer,
        width: VIEW_W + 400,
        height: fHeight + 40,
      });
      ts.tileScale.set(scale);
      ts.position.set(0, posY);
      return ts;
    };

    this.far = mkForest(GROUND_Y - 210);
    this.near = mkForest(GROUND_Y - 185);
    this.root.addChild(this.far, this.near);

    this.applyTheme(themeId);
  }

  applyTheme(themeId: number): void {
    const pal = THEMES[((themeId % THEMES.length) + THEMES.length) % THEMES.length]!;

    // 1. 天空渐变重绘（明亮纯净）
    this.skyG.clear();
    const grad = new FillGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, pal.skyTop);
    grad.addColorStop(0.52, pal.skyMid);
    grad.addColorStop(1, pal.skyBottom);
    this.skyG.rect(0, 0, VIEW_W, VIEW_H).fill(grad);

    // 2. 星空
    this.starsWrap.visible = pal.showStars;

    // 3. 太阳
    this.sunGlow.tint = pal.sunTint;
    this.sunGlow.alpha = pal.sunAlpha;
    this.sunCore.tint = pal.sunTint;

    // 4. 远山
    this.mountains.tint = pal.mountainTint;
    this.mountains.alpha = pal.mountainAlpha;

    // 5. 森林（保持原色明亮细节，雾化柔和层次）
    this.far.tint = pal.farForestTint;
    this.far.alpha = pal.farForestAlpha;
    this.near.tint = pal.nearForestTint;
    this.near.alpha = pal.nearForestAlpha;

    // 6. 云朵
    for (const c of this.clouds) {
      c.s.tint = pal.cloudTint;
      c.s.alpha = pal.cloudAlpha;
    }
  }

  update(camX: number, dtSec: number): void {
    this.t += dtSec;

    // 1. 远山极慢视差 (0.04)
    this.mountains.tilePosition.x = -camX * 0.04;

    // 2. 远林 (0.10) 与近林 (0.24) 视差
    this.far.tilePosition.x = -camX * 0.10;
    this.near.tilePosition.x = -camX * 0.24;

    // 3. 高空轻盈流云：微视差 (0.025) + 自然向左漂移
    const wrapW = VIEW_W + 500;
    for (const c of this.clouds) {
      c.driftX -= c.driftSpeed * dtSec;
      const screenX = ((c.baseX + c.driftX - camX * 0.025) % wrapW + wrapW) % wrapW - 200;
      c.s.position.set(screenX, c.y + Math.sin(this.t * 0.8 + c.baseX) * 3);
    }

    // 4. 太阳呼吸微光
    this.sunGlow.scale.set(3.8 + Math.sin(this.t * 1.5) * 0.2);
  }
}
