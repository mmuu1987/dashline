/** Imported Kenney poses, selected from snapshot state. Visuals never write into core. */
import { Container, Graphics, Sprite } from 'pixi.js';
import { PLAYER_R, type WorldSnapshot } from '@dashline/core';
import { skinColor, type CharacterFrames, type CharacterPose, type GameAssets } from './textures.js';
import type { SkinDef } from '../wardrobe.js';

export class BallActor {
  readonly root = new Container();
  private body = new Container();
  private character: Sprite;
  private frames: CharacterFrames;
  private shadow = new Graphics();
  private effects = new Graphics();
  private skin: SkinDef | null = null;
  private landedTick = -100;
  private lastTick = 0;
  hidden = false;

  constructor(private assets: GameAssets, private getSurfaceY?: (x: number, fromY: number) => number | null) {
    this.frames = assets.characters.green;
    this.character = new Sprite(this.frames.idle);
    // Feet are attached to the unchanged PLAYER_R collision support plane.
    this.character.anchor.set(0.5, 1);
    this.character.width = 34;
    this.character.height = 42;
    this.character.y = PLAYER_R;
    this.body.addChild(this.character);
    this.root.addChild(this.shadow, this.body, this.effects);
  }

  setSkin(skin: SkinDef): void {
    this.skin = skin;
    this.frames = this.assets.characters[skinColor(skin.id)];
    this.character.texture = this.frames.idle;
  }

  setState(snap: WorldSnapshot): void {
    if (this.hidden) return;
    this.lastTick = snap.tick;
    this.root.position.set(snap.x, snap.y);
    const pose: CharacterPose = !snap.alive ? 'hit' : snap.finished ? 'front' :
      snap.dashing || snap.slamming ? 'duck' : !snap.grounded ? 'jump' :
      Math.floor(snap.tick / 6) % 2 === 0 ? 'walk_a' : 'walk_b';
    this.character.texture = this.frames[pose];
    const squash = Math.max(0, 1 - (snap.tick - this.landedTick) / 10);
    const sy = snap.dashing ? 0.85 : snap.slamming ? 1.1 : 1 - squash * 0.08;
    const sx = snap.dashing ? 1.15 : 1 + squash * 0.06;
    this.body.scale.set(sx, sy * (snap.gravDir === -1 ? -1 : 1));
    // Compensate scale at the foot, rather than scaling the shadow/world position.
    this.body.y = snap.gravDir * PLAYER_R * (1 - sy);
    this.body.rotation = snap.dashing ? -0.1 * snap.gravDir : 0;
    this.character.tint = snap.boost > 0 ? 0xffefb6 : 0xffffff;

    this.shadow.clear();
    const surface = snap.gravDir === 1 ? this.getSurfaceY?.(snap.x, snap.y) : null;
    if (surface != null) {
      const opacity = Math.max(0, 1 - Math.max(0, surface - snap.y - PLAYER_R) / 180);
      this.shadow.ellipse(0, surface - snap.y - 1, 14 * opacity, 3).fill({ color: 0x243c46, alpha: opacity * 0.16 });
    }
    const g = this.effects;
    g.clear();
    if (!snap.alive) return;
    const color = this.skin?.primaryColor ?? 0x2bc48a;
    if (snap.hasShield) {
      g.circle(0, -3, 26).fill({ color: 0xe5f8ff, alpha: 0.18 }).stroke({ color: 0x479abc, width: 2.5 });
      g.arc(0, -3, 22, -2.7, -1.6).stroke({ color: 0xffffff, width: 3, cap: 'round' });
    }
    if (snap.magnetLeft > 0) {
      g.arc(0, -3, 29, -0.65, 0.65).stroke({ color: 0xe39e31, width: 2.5, cap: 'round' });
      g.arc(0, -3, 29, Math.PI - 0.65, Math.PI + 0.65).stroke({ color: 0xe39e31, width: 2.5, cap: 'round' });
    }
    if (snap.charge > 0.04) g.arc(0, -3, 30, -Math.PI / 2, -Math.PI / 2 + snap.charge * Math.PI * 2).stroke({ color: snap.charge >= 1 ? 0xe9a52f : color, width: 3.5, cap: 'round' });
    if (snap.dashing || snap.boost > 0) {
      for (let i = 0; i < 3; i++) g.moveTo(-23, -12 + i * 9).lineTo(-43 - i * 8, -12 + i * 9).stroke({ color, width: 3, alpha: 0.7 - i * 0.15, cap: 'round' });
    }
  }

  land(): void { this.landedTick = this.lastTick; }
  reset(x: number, y: number): void {
    this.hidden = false;
    this.root.visible = true;
    this.root.position.set(x, y);
    this.body.scale.set(1);
    this.body.position.set(0, 0);
    this.body.rotation = 0;
    this.character.texture = this.frames.idle;
    this.effects.clear();
    this.shadow.clear();
    this.landedTick = -100;
    this.lastTick = 0;
  }
  hide(): void { this.hidden = true; this.root.visible = false; }
}
