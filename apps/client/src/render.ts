/**
 * 渲染编排器：背景视差 → 赛道静态对象 → 拖尾 → 玩家 → 粒子 → 暗角。
 */
import { Container, Sprite } from 'pixi.js';
import { PLAYER_R, GROUND_Y, type Track, type WorldSnapshot } from '@dashline/core';
import { BallActor } from './render/actors.js';
import { Background } from './render/background.js';
import { VIEW_H, VIEW_W } from './render/consts.js';
import { Particles } from './render/particles.js';
import type { GameAssets } from './render/textures.js';
import { WorldView } from './render/worldview.js';

export { VIEW_H, VIEW_W } from './render/consts.js';

const TRAIL_INTERVAL = 0.04; // 40ms 一个残影

export class GameView {
  readonly root = new Container();
  readonly fx: Particles;

  private shakeWrap = new Container();
  /** 相机容器：赛道 / 粒子 / 玩家都在世界坐标系里，整体平移 -camX */
  private camera = new Container();
  private bg: Background;
  private worldView: WorldView;
  private player: BallActor;
  private vignette: Sprite;
  private camX = 0;
  private shakeAmp = 0;
  private lastT = 0;
  private trailT = 0;
  private runDustT = 0;

  constructor(assets: GameAssets, themeId = 0) {
    this.worldView = new WorldView(assets);
    this.bg = new Background(assets, themeId);
    this.player = new BallActor(assets, (x, y) => this.worldView.surfaceYBelow(x, y));
    this.fx = new Particles(assets);
    this.vignette = new Sprite(assets.vignette);

    // 背景自己做视差（直接吃 camX），其余世界对象统一挂进相机容器
    this.camera.addChild(
      this.worldView.root,
      this.fx.root,
      this.player.root,
    );
    this.shakeWrap.addChild(this.bg.root, this.camera);
    this.root.addChild(this.shakeWrap, this.vignette);
  }

  setTheme(themeId: number): void {
    this.bg.applyTheme(themeId);
  }

  setSkin(skin: import('./wardrobe.js').SkinDef): void {
    this.player.setSkin(skin);
  }

  setTrack(track: Track): void {
    this.worldView.setTrack(track);
  }

  onCoin(i: number): void {
    this.worldView.onCoin(i);
  }

  onShield(i: number): void {
    this.worldView.onShield(i);
  }

  onMagnet(i: number): void {
    this.worldView.onMagnet(i);
  }

  onNearMiss(x: number, y: number): void {
    this.fx.nearmiss(x, y);
    this.addShake(2.5);
  }

  onShieldBreak(x: number, y: number): void {
    this.fx.shieldBreak(x, y);
    this.addShake(8);
  }

  onPortal(x: number, y: number, dir: 1 | -1): void {
    this.fx.portalVortex(x, y, dir);
    this.addShake(3.5);
  }

  onDash(x: number, y: number): void {
    this.fx.dashBurst(x, y);
    this.addShake(4);
  }

  onSlam(x: number, y: number): void {
    this.fx.slamImpact(x, y);
    this.addShake(9);
  }

  getCoinPoint(i: number): { x: number; y: number } | null {
    return this.worldView.getCoinPoint(i);
  }

  getRingPoint(i: number): { x: number; y: number } | null {
    return this.worldView.getRingPoint(i);
  }

  getCrumbleCenter(i: number): { x: number; y: number } | null {
    return this.worldView.getCrumbleCenter(i);
  }

  addShake(amp: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  landSquash(): void {
    this.player.land();
  }

  resetCamera(): void {
    this.camX = 0;
  }

  /** 每次重开调用：清拖尾、复活玩家表现 */
  resetAttemptFx(startX: number, startY: number): void {
    this.player.reset(startX, startY);
    this.trailT = 0;
  }

  sync(snap: WorldSnapshot, tSec: number): void {
    const dt = Math.min(0.05, Math.max(0.001, tSec - this.lastT));
    this.lastT = tSec;

    // 相机只向前推进
    this.camX = Math.max(this.camX, snap.x - VIEW_W * 0.38);

    this.bg.update(this.camX, dt);
    this.camera.x = -this.camX;
    this.worldView.setCrumbles(snap.crumblesBroken);
    this.worldView.setTick(snap.tick, this.camX);
    this.worldView.setRingsGot(snap.ringsGot ?? []);
    this.worldView.update(tSec, this.camX);

    this.player.setState(snap);

    // 冲刺拖尾（存活且移动时；加速期间换金色）
    if (snap.alive && !snap.finished) {
      this.trailT += dt;
      if (this.trailT >= TRAIL_INTERVAL) {
        this.trailT = 0;
        if ((snap.boost ?? 0) > 0) {
          this.fx.trailGold(snap.x - PLAYER_R * 0.4, snap.y + (Math.random() - 0.5) * 8);
        } else {
          this.fx.trail(snap.x - PLAYER_R * 0.4, snap.y + (Math.random() - 0.5) * 6);
        }
      }
      // 跑动尾尘
      if (snap.grounded) {
        this.runDustT += dt;
        if (this.runDustT > 0.12) {
          this.runDustT = 0;
          this.fx.runDust(snap.x - PLAYER_R, GROUND_Y - 2);
        }
      }
    }

    this.fx.update(dt);

    // 震屏
    this.shakeAmp *= 0.88;
    if (this.shakeAmp < 0.3) this.shakeAmp = 0;
    this.shakeWrap.position.set(
      (Math.random() - 0.5) * 2 * this.shakeAmp,
      (Math.random() - 0.5) * 2 * this.shakeAmp,
    );
  }
}
