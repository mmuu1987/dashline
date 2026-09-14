/** Quiet, layered Kenney landscapes: low contrast behind the playable foreground. */
import { Container, FillGradient, Graphics, TilingSprite } from 'pixi.js';
import { VIEW_H, VIEW_W } from './consts.js';
import type { GameAssets } from './textures.js';

export const THEMES = [
  { name: '薄荷原野', top: 0xc4e8ef, bottom: 0xf6faef, tint: 0xffffff },
  { name: '杏色晨光', top: 0xf2dac8, bottom: 0xfff8e6, tint: 0xfff5e8 },
  { name: '海盐微风', top: 0xc6e5f3, bottom: 0xf3faf8, tint: 0xf0faff },
  { name: '桃色黎明', top: 0xefdbe0, bottom: 0xfff4e6, tint: 0xfff2ef },
  { name: '青柠山谷', top: 0xcde9da, bottom: 0xf7fae8, tint: 0xf4ffe9 },
  { name: '丁香晴日', top: 0xdddff0, bottom: 0xfaf5ec, tint: 0xf5f0ff },
  { name: '雾蓝远山', top: 0xcbdfe8, bottom: 0xf5f8ed, tint: 0xf2f8ff },
  { name: '翡翠旅途', top: 0xc7e8e2, bottom: 0xf1f9ed, tint: 0xeefff7 },
];

export class Background {
  readonly root = new Container();
  private sky = new Graphics();
  private gradient: FillGradient | null = null;
  private layers: { sprite: TilingSprite; speed: number }[] = [];

  constructor(assets: GameAssets, themeId = 0) {
    this.root.addChild(this.sky);
    // Source layers keep original aspect ratio; no solid forest strips or excessive bloom.
    const layer = (texture: typeof assets.clouds, y: number, scale: number, speed: number, alpha: number): void => {
      const sprite = new TilingSprite({ texture, width: VIEW_W + 4, height: 512 * scale });
      sprite.tileScale.set(scale);
      sprite.position.set(-2, y);
      sprite.alpha = alpha;
      this.layers.push({ sprite, speed });
      this.root.addChild(sprite);
    };
    layer(assets.clouds, -100, 1.35, 0.025, 0.8);
    layer(assets.hills, -85, 1.2, 0.07, 0.7);
    layer(assets.forestLayer, -10, 1.04, 0.14, 0.8);
    layer(assets.nearForest, 45, 1.02, 0.24, 0.22);
    this.applyTheme(themeId);
  }

  applyTheme(themeId: number): void {
    const theme = THEMES[((themeId % THEMES.length) + THEMES.length) % THEMES.length]!;
    this.sky.clear();
    this.gradient?.destroy();
    this.gradient = new FillGradient({
      type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: VIEW_H },
      colorStops: [{ offset: 0, color: theme.top }, { offset: 1, color: theme.bottom }],
      textureSpace: 'global',
    });
    this.sky.rect(0, 0, VIEW_W, VIEW_H).fill(this.gradient);
    for (const { sprite } of this.layers) sprite.tint = theme.tint;
  }

  update(camX: number, _dtSec: number): void {
    for (const { sprite, speed } of this.layers) sprite.tilePosition.x = -camX * speed;
  }
}
