/** 天空/太阳/云/多层远山 —— 全部静态构建，每帧只做视差位移。 */
import { Container, Graphics, Sprite } from 'pixi.js';
import { splitmix32 } from '@dashline/shared';
import { VIEW_H, VIEW_W } from './consts.js';
import type { GameAssets } from './textures.js';

function makeMountains(color: number, seed: number, baseY: number, amp: number, steps: number): Graphics {
  const g = new Graphics();
  const r = splitmix32(seed);
  const pts: number[] = [0, baseY];
  let x = 0;
  let up = true;
  for (let i = 0; i <= steps * 2; i++) {
    x += (VIEW_W * 2) / (steps * 2);
    const y = up ? baseY - amp * (0.55 + r() * 0.45) : baseY - amp * 0.18;
    pts.push(Math.min(x, VIEW_W * 2), y);
    up = !up;
  }
  pts.push(VIEW_W * 2, VIEW_H);
  pts.push(0, VIEW_H);
  g.poly(pts).fill(color);
  return g;
}

interface Cloud {
  s: Sprite;
  speed: number;
}

export class Background {
  readonly root = new Container();

  private far: Container;
  private near: Container;
  private clouds: Cloud[] = [];
  private sunGlow: Sprite;
  private t = 0;

  constructor(assets: GameAssets) {
    // 天空（屏幕空间，不参与视差）
    const sky = new Sprite(assets.sky);
    this.root.addChild(sky);

    // 太阳：柔光 + 核
    const sunWrap = new Container();
    sunWrap.position.set(VIEW_W * 0.78, 128);
    this.sunGlow = new Sprite(assets.glow);
    this.sunGlow.anchor.set(0.5);
    this.sunGlow.scale.set(3.4);
    this.sunGlow.tint = 0xffcf8e;
    this.sunGlow.alpha = 0.85;
    this.sunGlow.blendMode = 'add';
    const sunCore = new Sprite(assets.glow);
    sunCore.anchor.set(0.5);
    sunCore.scale.set(1.15);
    sunCore.tint = 0xfff2d0;
    sunWrap.addChild(this.sunGlow, sunCore);
    this.root.addChild(sunWrap);

    // 远山两层
    this.far = new Container();
    this.far.addChild(makeMountains(0x232b4c, 301, VIEW_H - 96, 150, 9));
    this.near = new Container();
    this.near.addChild(makeMountains(0x2d3560, 707, VIEW_H - 66, 104, 12));
    this.root.addChild(this.far, this.near);

    // 云
    const r = splitmix32(88);
    for (let i = 0; i < 5; i++) {
      const s = new Sprite(assets.cloud);
      s.anchor.set(0.5);
      s.position.set(r() * VIEW_W * 1.6, 40 + r() * 170);
      s.scale.set(0.45 + r() * 0.75);
      s.alpha = 0.42 + r() * 0.4;
      s.tint = 0xe6ecff;
      this.clouds.push({ s, speed: 7 + r() * 13 });
      this.root.addChild(s);
    }
  }

  update(camX: number, dtSec: number): void {
    this.t += dtSec;
    this.far.x = -((camX * 0.1) % VIEW_W);
    this.near.x = -((camX * 0.24) % VIEW_W);
    for (const c of this.clouds) {
      c.s.x -= c.speed * dtSec;
      if (c.s.x < -260) {
        c.s.x = VIEW_W + 240;
        c.s.y = 30 + Math.random() * 180;
      }
    }
    // 太阳呼吸
    this.sunGlow.alpha = 0.75 + Math.sin(this.t * 1.4) * 0.12;
  }
}
