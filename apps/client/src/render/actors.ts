/**
 * 高级主角角色渲染系统：
 * 1. 4 款多形态萌系皮肤渲染（星之灵宝、樱粉小狐、暗夜幽灵、霓虹机甲）
 * 2. 灵动萌态面部：大眼萌星眸、晶莹高光、动态眨眼动画、粉嫩腮红
 * 3. 动态灵耳/狐耳/猫耳/科技天线（随跳跃自然摆动）
 * 4. 专属奔跑魔法拖尾（流光飘带 / 樱花花瓣 / 幽蓝鬼火 / 矩阵光轨）
 * 5. 上下重力反转翻转、水晶护盾光罩、磁力电光与蓄力光环
 */
import { Container, Graphics, Sprite } from 'pixi.js';
import { PLAYER_R, type WorldSnapshot } from '@dashline/core';
import type { GameAssets } from './textures.js';
import type { SkinDef } from '../wardrobe.js';

export class BallActor {
  readonly root = new Container();

  private roller: Sprite;
  private aura: Sprite;
  private trailG = new Graphics();
  private earL = new Container();
  private earR = new Container();
  private face = new Container();
  private eyeL: Container;
  private eyeR: Container;
  private blushL: Graphics;
  private blushR: Graphics;
  private mouth: Graphics;
  private deadFace: Graphics;
  private shieldBarrier: Graphics;
  private shadow: Sprite;

  private lastX = 0;
  private lastY = 0;
  private squash = 0;
  private animT = 0;
  private blinkT = 0;
  private isBlinking = false;
  private currentSkin: SkinDef | null = null;
  hidden = false;

  constructor(
    private assets: GameAssets,
    getSurfaceY?: (x: number, fromY: number) => number | null,
  ) {
    const r = PLAYER_R;

    // 0. 背后专属魔法拖尾
    this.root.addChild(this.trailG);

    // 1. 周身微光光晕（Aura）
    this.aura = new Sprite(assets.glow);
    this.aura.anchor.set(0.5);
    this.aura.scale.set((r * 3.2) / 128);
    this.aura.tint = 0x38bdf8;
    this.aura.alpha = 0.45;
    this.aura.blendMode = 'add';
    this.root.addChild(this.aura);

    // 2. 晶莹球体（随位移滚动）
    this.roller = new Sprite(assets.ball);
    this.roller.anchor.set(0.5);
    this.roller.scale.set((r * 2.1) / this.roller.texture.width);
    this.root.addChild(this.roller);

    // 3. 萌系耳饰组件
    this.rebuildEars('spirit', 0x38bdf8, 0xf472b6);
    this.root.addChild(this.earL, this.earR);

    // 4. 萌态生动面部
    const makeCuteEye = (): Container => {
      const eyeWrap = new Container();
      const g = new Graphics();
      // 眼白
      g.ellipse(0, 0, 5.2, 6.2).fill(0xffffff).stroke({ width: 1.2, color: 0x0f172a });
      // 晶莹瞳孔
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

    // 粉嫩腮红
    this.blushL = new Graphics();
    this.blushR = new Graphics();
    this.blushL.ellipse(-r * 0.52, r * 0.12, 3.2, 1.8).fill({ color: 0xf43f5e, alpha: 0.45 });
    this.blushR.ellipse(r * 0.56, r * 0.12, 3.2, 1.8).fill({ color: 0xf43f5e, alpha: 0.45 });
    this.face.addChild(this.blushL, this.blushR);

    // 微笑唇
    this.mouth = new Graphics();
    this.mouth.moveTo(-1.8, r * 0.18).lineTo(0, r * 0.28).lineTo(1.8, r * 0.18).stroke({
      width: 1.5,
      color: 0x0f172a,
      cap: 'round',
    });
    this.face.addChild(this.mouth);

    // 撞毁表情
    this.deadFace = new Graphics();
    for (const ex of [-r * 0.32, r * 0.36]) {
      this.deadFace
        .moveTo(ex - 4, -r * 0.18 - 3).lineTo(ex, -r * 0.18).lineTo(ex - 4, -r * 0.18 + 3)
        .stroke({ width: 2.2, color: 0xf43f5e, cap: 'round' });
    }
    this.deadFace.circle(r * 0.62, -r * 0.35, 2.2).fill(0x38bdf8);
    this.deadFace.visible = false;
    this.face.addChild(this.deadFace);

    this.root.addChild(this.face);

    // 5. 环体护盾水晶光罩（拾取护盾后出现）
    this.shieldBarrier = new Graphics();
    this.shieldBarrier.circle(0, 0, r + 7).stroke({ width: 2.5, color: 0x38bdf8, alpha: 0.85 });
    this.shieldBarrier.circle(0, 0, r + 9).stroke({ width: 1.5, color: 0xffffff, alpha: 0.65 });
    this.shieldBarrier.visible = false;
    this.root.addChild(this.shieldBarrier);

    // 6. 接地阴影
    this.shadow = new Sprite(this.assets.glow);
    this.shadow.anchor.set(0.5);
    this.shadow.tint = 0x000000;
    this.shadow.alpha = 0;
    if (getSurfaceY) {
      this.getSurfaceY = getSurfaceY;
      this.root.addChildAt(this.shadow, 0);
    }

    // 7. 蓄力光环
    this.chargeRing = new Graphics();
    this.chargeRing.visible = false;
    this.root.addChild(this.chargeRing);
  }

  private rebuildEars(type: 'spirit' | 'fox' | 'cat' | 'mecha', primaryCol: number, secondaryCol: number): void {
    const r = PLAYER_R;
    this.earL.removeChildren();
    this.earR.removeChildren();

    const drawOne = (isRight: boolean): Graphics => {
      const g = new Graphics();
      if (type === 'fox') {
        // 狐狸尖耳
        g.poly([
          { x: -r * 0.22, y: 0 },
          { x: 0, y: -r * 0.85 },
          { x: r * 0.22, y: 0 },
        ])
          .fill({ color: primaryCol })
          .stroke({ width: 1.5, color: secondaryCol });
        g.poly([
          { x: -r * 0.12, y: -r * 0.05 },
          { x: 0, y: -r * 0.65 },
          { x: r * 0.12, y: -r * 0.05 },
        ]).fill({ color: 0xffffff, alpha: 0.9 });
      } else if (type === 'cat') {
        // 可爱圆润猫耳
        g.poly([
          { x: -r * 0.25, y: 0 },
          { x: 0, y: -r * 0.65 },
          { x: r * 0.25, y: 0 },
        ])
          .fill({ color: primaryCol })
          .stroke({ width: 1.5, color: secondaryCol });
        g.poly([
          { x: -r * 0.14, y: 0 },
          { x: 0, y: -r * 0.45 },
          { x: r * 0.14, y: 0 },
        ]).fill({ color: 0xf472b6, alpha: 0.85 });
      } else if (type === 'mecha') {
        // 科技机械天线
        g.rect(-r * 0.08, -r * 0.75, r * 0.16, r * 0.75).fill(secondaryCol);
        g.circle(0, -r * 0.75, r * 0.22).fill(primaryCol).stroke({ width: 1.5, color: 0xffffff });
      } else {
        // 默认精灵兔耳
        g.ellipse(0, -r * 0.45, r * 0.28, r * 0.55)
          .fill({ color: primaryCol })
          .stroke({ width: 1.5, color: secondaryCol });
        g.ellipse(0, -r * 0.42, r * 0.15, r * 0.36).fill({ color: secondaryCol, alpha: 0.85 });
      }
      return g;
    };

    const gL = drawOne(false);
    const gR = drawOne(true);
    this.earL.addChild(gL);
    this.earR.addChild(gR);
    this.earL.position.set(-r * 0.35, -r * 0.65);
    this.earR.position.set(r * 0.35, -r * 0.65);
    this.earL.rotation = -0.25;
    this.earR.rotation = 0.25;
  }

  setSkin(skin: SkinDef): void {
    this.currentSkin = skin;
    this.aura.tint = skin.primaryColor;
    this.rebuildEars(skin.earType, skin.primaryColor, skin.secondaryColor);
  }

  private getSurfaceY?: (x: number, fromY: number) => number | null;
  private chargeRing: Graphics | null = null;
  private pulseT = 0;
  private chargeV = 0;

  setState(snap: WorldSnapshot): void {
    if (this.hidden) return;
    this.animT += 0.05;

    // 1. 滚动角速度
    const dx = snap.x - this.lastX;
    this.roller.rotation += dx / PLAYER_R;
    this.lastX = snap.x;
    this.lastY = snap.y;
    this.root.position.set(snap.x, snap.y);

    // 2. 加速带金光与护盾光罩
    const isBoost = (snap.boost ?? 0) > 0;
    const skin = this.currentSkin;
    const pCol = skin ? skin.primaryColor : 0x38bdf8;
    this.roller.tint = isBoost ? 0xfef08a : 0xffffff;
    this.aura.tint = isBoost ? 0xfde047 : pCol;
    this.aura.alpha = 0.4 + Math.sin(this.animT * 2) * 0.08;

    // 护盾光罩旋转
    this.shieldBarrier.visible = snap.hasShield && snap.alive;
    if (this.shieldBarrier.visible) {
      this.shieldBarrier.rotation += 0.06;
      this.shieldBarrier.scale.set(1 + Math.sin(this.animT * 4) * 0.05);
    }

    // 3. 动态眨眼
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

    // 4. 灵耳随运动飘动
    const earBob = Math.sin(this.animT * 3.5) * 0.12;
    const vyFactor = Math.max(-0.6, Math.min(0.6, snap.vy / 800));
    this.earL.rotation = -0.28 - earBob + vyFactor * 0.3;
    this.earR.rotation = 0.28 + earBob + vyFactor * 0.3;

    // 5. 皮肤专属拖尾绘制
    if (snap.alive) {
      this.trailG.clear();
      const sY = -PLAYER_R * 0.2;
      const sX = -PLAYER_R * 0.7;
      const wave = Math.sin(this.animT * 5) * 4;
      const trailType = skin?.trailType ?? 'streamer';

      if (trailType === 'petals') {
        // 飘零花瓣
        for (let i = 0; i < 3; i++) {
          const px = sX - 12 - i * 14;
          const py = sY + Math.sin(this.animT * 4 + i) * 6;
          this.trailG.ellipse(px, py, 4, 2.5).fill({ color: 0xf472b6, alpha: 0.8 - i * 0.2 });
        }
      } else if (trailType === 'flames') {
        // 幽火光轨
        this.trailG
          .moveTo(sX, sY)
          .quadraticCurveTo(sX - 14, sY + wave * 0.8, sX - 26, sY - wave * 0.5)
          .stroke({ width: 4.5, color: 0xa855f7, alpha: 0.85, cap: 'round' });
        this.trailG
          .moveTo(sX, sY)
          .quadraticCurveTo(sX - 10, sY - wave * 0.6, sX - 18, sY + wave * 0.4)
          .stroke({ width: 2.5, color: 0x38bdf8, alpha: 0.9, cap: 'round' });
      } else if (trailType === 'matrix') {
        // 赛博方块光轨
        for (let i = 0; i < 3; i++) {
          const qx = sX - 8 - i * 12;
          const qy = sY + Math.sin(this.animT * 6 + i) * 5;
          this.trailG.rect(qx, qy, 4, 4).fill({ color: 0xfacc15, alpha: 0.9 - i * 0.25 });
        }
      } else {
        // 默认流光飘带
        this.trailG
          .moveTo(sX, sY)
          .quadraticCurveTo(sX - 12, sY + wave - 2, sX - 22, sY - wave * 0.6)
          .stroke({ width: 3.5, color: isBoost ? 0xfde047 : 0x7dd3fc, alpha: 0.85, cap: 'round' });
        this.trailG
          .moveTo(sX - 2, sY + 2)
          .quadraticCurveTo(sX - 10, sY + wave + 2, sX - 18, sY + wave * 0.4)
          .stroke({ width: 2, color: 0xffffff, alpha: 0.9, cap: 'round' });
      }
    } else {
      this.trailG.clear();
    }

    // 6. 蓄力光环
    this.chargeV = snap.charge ?? 0;
    if (this.chargeRing) {
      const c = this.chargeV;
      if (c > 0.04) {
        this.pulseT += 0.16;
        const full = c >= 1;
        const r = PLAYER_R + 8 + (full ? Math.sin(this.pulseT) * 2.2 : 0);
        const col = full ? 0xffffff : c > 0.6 ? 0xffd23f : pCol;
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
    const isDead = !snap.alive;
    this.deadFace.visible = isDead;
    this.eyeL.visible = !isDead;
    this.eyeR.visible = !isDead;
    this.mouth.visible = !isDead;

    // 8. 挤压、拉伸与重力反转朝向
    this.squash *= 0.86;
    let sy = 1 - 0.24 * this.squash;
    let sx = 1 + 0.18 * this.squash;
    if (snap.dashing) {
      // 破风冲刺：水平流线拉伸
      sx = 1.35;
      sy = 0.72;
    } else if (snap.slamming) {
      // 极速下砸：垂直锋利拉伸
      sy = 1.38;
      sx = 0.72;
    } else if (!snap.grounded && snap.vy < -250) {
      sy = Math.max(sy, 1.14);
      sx = Math.min(sx, 0.9);
    }
    if (this.chargeV > 0.04 && !snap.dashing && !snap.slamming) {
      sy *= 1 + this.chargeV * 0.15;
      sx *= 1 - this.chargeV * 0.08;
    }
    // 当处于反向重力（天花板倒挂）时，人物自然上下颠倒
    const gravSign = snap.gravDir === -1 ? -1 : 1;
    this.root.scale.set(sx, sy * gravSign);

    // 9. 阴影
    if (this.getSurfaceY && snap.gravDir === 1) {
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
    } else {
      this.shadow.alpha = 0;
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
      gravDir: 1,
      hasShield: false,
      magnetLeft: 0,
      combo: 0,
      dashing: false,
      slamming: false,
      canAirDash: true,
    } satisfies WorldSnapshot);
  }

  hide(): void {
    this.hidden = true;
    this.root.visible = false;
  }
}
