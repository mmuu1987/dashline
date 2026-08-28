/**
 * 高级主角角色渲染系统：
 * 1. 晶莹剔透的水晶精灵球体（星之灵宝 Lumina）
 * 2. 灵动萌态面部：大眼萌星眸、晶莹高光、动态眨眼动画、粉嫩微红腮红与微甜微笑
 * 3. 动态萌系灵耳（随跑动、起跳、下落自然摆动与反冲）
 * 4. 奔跑魔法流光飘带（随运动轨迹与速度飘逸）
 * 5. 接地柔和阴影 + 蓄力光环 + 动态挤压拉伸
 */
import { Container, Graphics, Sprite } from 'pixi.js';
import { PLAYER_R, type WorldSnapshot } from '@dashline/core';
import type { GameAssets } from './textures.js';

export class BallActor {
  readonly root = new Container();

  private roller: Sprite;
  private aura: Sprite;
  private scarf = new Graphics();
  private earL = new Container();
  private earR = new Container();
  private face = new Container();
  private eyeL: Container;
  private eyeR: Container;
  private blushL: Graphics;
  private blushR: Graphics;
  private mouth: Graphics;
  private deadFace: Graphics;
  private shadow: Sprite;

  private lastX = 0;
  private lastY = 0;
  private squash = 0;
  private animT = 0;
  private blinkT = 0;
  private isBlinking = false;
  hidden = false;

  constructor(
    private assets: GameAssets,
    private ghostMode: boolean,
    getSurfaceY?: (x: number, fromY: number) => number | null,
  ) {
    const r = PLAYER_R;

    // 0. 背后魔法流光飘带
    this.root.addChild(this.scarf);

    // 1. 周身微光光晕（Aura）
    this.aura = new Sprite(assets.glow);
    this.aura.anchor.set(0.5);
    this.aura.scale.set((r * 3.2) / 128);
    this.aura.tint = ghostMode ? 0xaab6d8 : 0x38bdf8;
    this.aura.alpha = ghostMode ? 0.15 : 0.45;
    this.aura.blendMode = 'add';
    this.root.addChild(this.aura);

    // 2. 晶莹球体（随位移滚动）
    this.roller = new Sprite(assets.ball);
    this.roller.anchor.set(0.5);
    this.roller.scale.set((r * 2.1) / this.roller.texture.width);
    if (ghostMode) {
      this.roller.tint = 0xaab6d8;
      this.roller.alpha = 0.38;
    }
    this.root.addChild(this.roller);

    // 3. 萌系精灵双耳（位于头顶两侧，随跳跃自然摆动）
    const makeEar = (isRight: boolean): Container => {
      const c = new Container();
      const g = new Graphics();
      // 外耳（柔和天蓝）
      g.ellipse(0, -r * 0.45, r * 0.28, r * 0.55)
        .fill({ color: 0x38bdf8 })
        .stroke({ width: 1.5, color: 0x0284c7 });
      // 内耳（粉嫩渐变）
      g.ellipse(0, -r * 0.42, r * 0.15, r * 0.36).fill({ color: 0xf472b6, alpha: 0.85 });
      c.addChild(g);
      c.position.set(isRight ? r * 0.35 : -r * 0.35, -r * 0.65);
      c.rotation = isRight ? 0.25 : -0.25;
      return c;
    };
    this.earL = makeEar(false);
    this.earR = makeEar(true);
    if (ghostMode) {
      this.earL.alpha = 0.4;
      this.earR.alpha = 0.4;
    }
    this.root.addChild(this.earL, this.earR);

    // 4. 萌态生动面部（不随球体旋转）
    const makeCuteEye = (): Container => {
      const eyeWrap = new Container();
      const g = new Graphics();
      // 眼白
      g.ellipse(0, 0, 5.2, 6.2).fill(0xffffff).stroke({ width: 1.2, color: 0x0f172a });
      // 晶莹瞳孔（深海蓝渐变效果）
      g.ellipse(0.8, 0.4, 3.6, 4.5).fill(0x0284c7);
      g.ellipse(1.0, 0.6, 2.4, 3.0).fill(0x082f49);
      // 主高光星眸
      g.circle(-0.8, -1.8, 1.8).fill(0xffffff);
      // 次级反光
      g.circle(1.8, 2.0, 0.9).fill(0xe0f2fe);
      eyeWrap.addChild(g);
      return eyeWrap;
    };

    this.eyeL = makeCuteEye();
    this.eyeR = makeCuteEye();
    this.eyeL.position.set(-r * 0.32, -r * 0.18);
    this.eyeR.position.set(r * 0.36, -r * 0.18);
    this.face.addChild(this.eyeL, this.eyeR);

    // 粉嫩腮红（Blush）
    this.blushL = new Graphics();
    this.blushR = new Graphics();
    this.blushL.ellipse(-r * 0.52, r * 0.12, 3.2, 1.8).fill({ color: 0xf43f5e, alpha: 0.45 });
    this.blushR.ellipse(r * 0.56, r * 0.12, 3.2, 1.8).fill({ color: 0xf43f5e, alpha: 0.45 });
    this.face.addChild(this.blushL, this.blushR);

    // 微甜笑唇
    this.mouth = new Graphics();
    this.mouth.moveTo(-1.8, r * 0.18).lineTo(0, r * 0.28).lineTo(1.8, r * 0.18).stroke({
      width: 1.5,
      color: 0x0f172a,
      cap: 'round',
    });
    this.face.addChild(this.mouth);

    // 撞毁后的可爱晕倒面部（>_< 眼 + 眩晕波纹）
    this.deadFace = new Graphics();
    for (const ex of [-r * 0.32, r * 0.36]) {
      this.deadFace
        .moveTo(ex - 4, -r * 0.18 - 3).lineTo(ex, -r * 0.18).lineTo(ex - 4, -r * 0.18 + 3)
        .stroke({ width: 2.2, color: 0xf43f5e, cap: 'round' });
    }
    // 可爱泪滴/汗滴
    this.deadFace.circle(r * 0.62, -r * 0.35, 2.2).fill(0x38bdf8);
    this.deadFace.visible = false;
    this.face.addChild(this.deadFace);

    if (ghostMode) this.face.alpha = 0.4;
    this.root.addChild(this.face);

    // 5. 接地柔和阴影（仅玩家）
    this.shadow = new Sprite(this.assets.glow);
    this.shadow.anchor.set(0.5);
    this.shadow.tint = 0x000000;
    this.shadow.alpha = 0;
    if (!ghostMode && getSurfaceY) {
      this.getSurfaceY = getSurfaceY;
      this.root.addChildAt(this.shadow, 0);
    }

    // 6. 蓄力光环（仅玩家）
    if (!ghostMode) {
      this.chargeRing = new Graphics();
      this.chargeRing.visible = false;
      this.root.addChild(this.chargeRing);
    }
  }

  private getSurfaceY?: (x: number, fromY: number) => number | null;
  private chargeRing: Graphics | null = null;
  private pulseT = 0;
  private chargeV = 0;

  setState(snap: WorldSnapshot): void {
    if (this.hidden) return;
    this.animT += 0.05;

    // 1. 滚动角速度 = 水平位移 / 半径
    const dx = snap.x - this.lastX;
    this.roller.rotation += dx / PLAYER_R;
    this.lastX = snap.x;
    this.lastY = snap.y;
    this.root.position.set(snap.x, snap.y);

    // 2. 加速带高能金光
    const isBoost = (snap.boost ?? 0) > 0;
    this.roller.tint = isBoost ? 0xfef08a : this.ghostMode ? 0xaab6d8 : 0xffffff;
    this.aura.tint = isBoost ? 0xfde047 : this.ghostMode ? 0xaab6d8 : 0x38bdf8;
    this.aura.alpha = (this.ghostMode ? 0.15 : 0.4) + Math.sin(this.animT * 2) * 0.08;

    // 3. 动态自然眨眼（每 ~3.8 秒眨眼一次）
    this.blinkT += 0.03;
    if (this.blinkT > 3.8) {
      this.isBlinking = true;
      if (this.blinkT > 3.95) {
        this.blinkT = 0;
        this.isBlinking = false;
      }
    }
    const blinkScale = this.isBlinking ? 0.1 : 1;
    this.eyeL.scale.y = blinkScale;
    this.eyeR.scale.y = blinkScale;

    // 4. 灵耳随运动动态飘动
    const earBob = Math.sin(this.animT * 3.5) * 0.12;
    const vyFactor = Math.max(-0.6, Math.min(0.6, snap.vy / 800));
    this.earL.rotation = -0.28 - earBob + vyFactor * 0.3;
    this.earR.rotation = 0.28 + earBob + vyFactor * 0.3;

    // 5. 魔法流光飘带绘制（随运动自然向后飘动）
    if (!this.ghostMode && snap.alive) {
      this.scarf.clear();
      const sY = -PLAYER_R * 0.2;
      const sX = -PLAYER_R * 0.7;
      const wave = Math.sin(this.animT * 5) * 4;
      this.scarf
        .moveTo(sX, sY)
        .quadraticCurveTo(sX - 12, sY + wave - 2, sX - 22, sY - wave * 0.6)
        .stroke({ width: 3.5, color: isBoost ? 0xfde047 : 0x7dd3fc, alpha: 0.85, cap: 'round' });
      this.scarf
        .moveTo(sX - 2, sY + 2)
        .quadraticCurveTo(sX - 10, sY + wave + 2, sX - 18, sY + wave * 0.4)
        .stroke({ width: 2, color: 0xffffff, alpha: 0.9, cap: 'round' });
    } else {
      this.scarf.clear();
    }

    // 6. 蓄力光环
    this.chargeV = snap.charge ?? 0;
    if (this.chargeRing) {
      const c = this.chargeV;
      if (c > 0.04) {
        this.pulseT += 0.16;
        const full = c >= 1;
        const r = PLAYER_R + 8 + (full ? Math.sin(this.pulseT) * 2.2 : 0);
        const col = full ? 0xffffff : c > 0.6 ? 0xffd23f : 0x38bdf8;
        const g = this.chargeRing;
        g.clear();
        g.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + c * Math.PI * 2).stroke({
          width: full ? 5 : 4,
          color: col,
          alpha: 0.95,
        });
        g.arc(0, 0, r, -Math.PI / 2 + c * Math.PI * 2, -Math.PI / 2 + Math.PI * 2).stroke({
          width: 2,
          color: col,
          alpha: 0.16,
        });
        if (full) g.circle(0, 0, r + 7).stroke({ width: 1.5, color: 0xffd23f, alpha: 0.55 });
        g.visible = true;
      } else {
        this.chargeRing.visible = false;
      }
    }

    // 7. 死亡与表情切换
    const isDead = !snap.alive && !this.ghostMode;
    this.deadFace.visible = isDead;
    this.eyeL.visible = !isDead;
    this.eyeR.visible = !isDead;
    this.mouth.visible = !isDead;

    // 8. 挤压与拉伸
    this.squash *= 0.86;
    let sy = 1 - 0.24 * this.squash;
    let sx = 1 + 0.18 * this.squash;
    if (!snap.grounded && snap.vy < -250) {
      sy = Math.max(sy, 1.14);
      sx = Math.min(sx, 0.9);
    }
    if (this.chargeV > 0.04) {
      sy *= 1 + this.chargeV * 0.15;
      sx *= 1 - this.chargeV * 0.08;
    }
    this.root.scale.set(sx, sy);

    // 9. 阴影随离地高度衰减
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
    this.lastY = y;
    this.hidden = false;
    this.root.visible = true;
    this.setState({
      tick: 0,
      x,
      y,
      vy: 0,
      grounded: true,
      alive: true,
      finished: false,
      score: 0,
      timeMs: 0,
      distanceM: 0,
      coinCount: 0,
      crumblesBroken: [],
      ringsGot: [],
      boost: 0,
      airJumps: 0,
      charge: 0,
    } satisfies WorldSnapshot);
  }

  hide(): void {
    this.hidden = true;
    this.root.visible = false;
  }
}
