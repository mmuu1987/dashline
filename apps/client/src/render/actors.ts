/** 滚球主角 / Ghost：滚动可见的条纹球 + 直立的脸 + 接地阴影 + 挤压拉伸。 */
import { Container, Graphics, Sprite } from 'pixi.js';
import { PLAYER_R, type WorldSnapshot } from '@dashline/core';
import type { GameAssets } from './textures.js';

export class BallActor {
  readonly root = new Container();

  private roller: Sprite;
  private face = new Container();
  private eyeL: Graphics;
  private eyeR: Graphics;
  private deadFace: Graphics;
  private shadow: Sprite;
  private lastX = 0;
  private squash = 0;
  hidden = false;

  constructor(
    private assets: GameAssets,
    private ghostMode: boolean,
    getSurfaceY?: (x: number, fromY: number) => number | null,
  ) {
    this.roller = new Sprite(assets.ball);
    this.roller.anchor.set(0.5);
    this.roller.scale.set((PLAYER_R * 2) / this.roller.texture.width);
    if (ghostMode) {
      this.roller.tint = 0xaab6d8;
      this.roller.alpha = 0.34;
    }
    this.root.addChild(this.roller);

    // 脸（不随球滚）
    const r = PLAYER_R;
    const drawEye = (): Graphics => {
      const e = new Graphics();
      e.circle(0, 0, 5.2).fill(0xffffff);
      e.circle(1.6, 0, 2.6).fill(0x123240);
      return e;
    };
    this.eyeL = drawEye();
    this.eyeR = drawEye();
    this.eyeL.position.set(-r * 0.38, -r * 0.28);
    this.eyeR.position.set(r * 0.42, -r * 0.28);
    this.face.addChild(this.eyeL, this.eyeR);

    // 撞毁后的 X 眼
    this.deadFace = new Graphics();
    for (const ex of [-r * 0.38, r * 0.42]) {
      this.deadFace
        .moveTo(ex - 4, -r * 0.28 - 4).lineTo(ex + 4, -r * 0.28 + 4)
        .moveTo(ex + 4, -r * 0.28 - 4).lineTo(ex - 4, -r * 0.28 + 4)
        .stroke({ width: 2.6, color: 0xff5566 });
    }
    this.deadFace.visible = false;
    this.face.addChild(this.deadFace);
    if (ghostMode) this.face.alpha = 0.3;
    this.root.addChild(this.face);

    // 接地阴影（仅玩家）
    this.shadow = new Sprite(this.assets.glow);
    this.shadow.anchor.set(0.5);
    this.shadow.tint = 0x000000;
    this.shadow.alpha = 0;
    if (!ghostMode && getSurfaceY) {
      this.getSurfaceY = getSurfaceY;
      this.root.addChildAt(this.shadow, 0);
    }

    // 蓄力环（仅玩家）：长按上升段显示，弧长 = 蓄力进度
    if (!ghostMode) {
      this.chargeRing = new Graphics();
      this.chargeRing.visible = false;
      this.root.addChild(this.chargeRing);
    }
  }

  private getSurfaceY?: (x: number, fromY: number) => number | null;
  private chargeRing: Graphics | null = null;

  setState(snap: WorldSnapshot): void {
    if (this.hidden) return;
    // 滚动角速度 = 位移 / 半径
    this.roller.rotation += (snap.x - this.lastX) / PLAYER_R;
    this.lastX = snap.x;
    this.root.position.set(snap.x, snap.y);
    // 加速带增益期间镀金
    this.roller.tint =
      (snap.boost ?? 0) > 0 ? 0xffd97a : this.ghostMode ? 0xaab6d8 : 0xffffff;

    // 蓄力环：金色弧随蓄力进度增长
    if (this.chargeRing) {
      const c = snap.charge;
      if (c > 0.04) {
        const g = this.chargeRing;
        g.clear();
        g.arc(0, 0, PLAYER_R + 8, -Math.PI / 2, -Math.PI / 2 + c * Math.PI * 2).stroke({
          width: 3,
          color: c >= 1 ? 0xffd23f : 0xffe08a,
          alpha: 0.9,
        });
        g.visible = true;
      } else {
        this.chargeRing.visible = false;
      }
    }

    // 眼睛看向前进方向；死亡切 X 眼
    this.deadFace.visible = !snap.alive && !this.ghostMode;
    const look = snap.alive ? 1.8 : 0;
    this.eyeL.pivot.x = look;
    this.eyeR.pivot.x = look;

    // 挤压拉伸（与旧版一致的手感表现）
    this.squash *= 0.86;
    let sy = 1 - 0.26 * this.squash;
    let sx = 1 + 0.2 * this.squash;
    if (!snap.grounded && snap.vy < -250) {
      sy = Math.max(sy, 1.12);
      sx = Math.min(sx, 0.92);
    }
    this.root.scale.set(sx, sy);

    // 阴影随离地高度衰减
    if (this.getSurfaceY) {
      const sy2 = this.getSurfaceY(snap.x, snap.y);
      if (sy2 !== null) {
        const d = Math.max(0, sy2 - snap.y - PLAYER_R);
        const k = Math.max(0, 1 - d / 220);
        this.shadow.position.set(0, sy2 - snap.y - 3);
        this.shadow.scale.set(0.24 + k * 0.14);
        this.shadow.alpha = 0.28 * k;
      } else {
        this.shadow.alpha = 0;
      }
    }
  }

  land(): void {
    this.squash = 1;
  }

  reset(x: number, y: number): void {
    this.lastX = x;
    this.hidden = false;
    this.root.visible = true;
    this.setState({ tick: 0, x, y, vy: 0, grounded: true, alive: true, finished: false, score: 0, timeMs: 0, distanceM: 0, coinCount: 0, crumblesBroken: [], ringsGot: [], boost: 0, airJumps: 0, charge: 0 } satisfies WorldSnapshot);
  }

  hide(): void {
    this.hidden = true;
    this.root.visible = false;
  }
}
