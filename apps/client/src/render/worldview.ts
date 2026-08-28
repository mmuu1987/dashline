import { Container, Graphics, Sprite, TilingSprite, type Texture } from 'pixi.js';
import { GROUND_Y, SPIKE_W, isGateActive, moverOffsetY, pendulumBob, type Track } from '@dashline/core';
import { splitmix32 } from '@dashline/shared';
import { VIEW_H, VIEW_W } from './consts.js';
import type { GameAssets } from './textures.js';

export class WorldView {
  readonly root = new Container();

  private coinSprites: Sprite[] = [];
  private flagCloth: Sprite | null = null;
  private track: Track | null = null;
  /** 弹跳菇（用于呼吸脉冲） */
  private padCaps: Graphics[] = [];
  /** 碎裂板精灵，下标与 track.plats 对齐 */
  private crumbleSprites: (Container | null)[] = [];
  private brokenPlats = new Set<number>();
  /** 升降台容器（下标与 track.plats 对齐，随 simTick 摆动） */
  private moverSprites: (Container | null)[] = [];
  private simTick = 0;
  /** 二段跳环 */
  private ringSprites: Container[] = [];
  private ringsGotSet = new Set<number>();
  /** 重力门、护盾与磁铁道具 */
  private portalSprites: Container[] = [];
  private shieldSprites: Container[] = [];
  private magnetSprites: Container[] = [];
  private shieldsGotSet = new Set<number>();
  private magnetsGotSet = new Set<number>();

  /** 加速带动画 */
  private boostFx: Array<{
    chevrons: Graphics[];
    bx: number[];
    zx: number;
    zw: number;
  }> = [];
  /** 横扫钉球：球容器 + 链条（随 simTick 摆动） */
  private pendulumSprites: (Container | null)[] = [];
  private pendulumChains: (Graphics | null)[] = [];
  /** 激光闸门 */
  private gateBeams: Graphics[] = [];
  private gateDiodes: Graphics[] = [];
  /** 上升气流柱动画 */
  private windStreams: Array<{ g: Graphics; x: number; w: number; h: number }> = [];

  constructor(private assets: GameAssets) {}

  setTrack(track: Track): void {
    this.track = track;
    this.root.removeChildren().forEach((c) => c.destroy());
    this.coinSprites = [];
    this.padCaps = [];
    this.crumbleSprites = [];
    this.brokenPlats.clear();
    this.moverSprites = [];
    this.ringSprites = [];
    this.ringsGotSet.clear();
    this.portalSprites = [];
    this.shieldSprites = [];
    this.shieldsGotSet.clear();
    this.magnetSprites = [];
    this.magnetsGotSet.clear();
    this.boostFx = [];
    this.pendulumSprites = [];
    this.pendulumChains = [];
    this.gateBeams = [];
    this.gateDiodes = [];
    this.windStreams = [];

    // 坑底暗色
    const backdrop = new Graphics();
    backdrop.rect(-400, GROUND_Y + 2, track.length + 800, VIEW_H - GROUND_Y + 80).fill(0x0c101c);
    this.root.addChild(backdrop);

    // 地面段：草顶行 + 泥土填充
    const GS = 2.5;
    const TOP_H = 16 * GS;
    for (const seg of track.grounds) {
      const w = seg.x1 - seg.x0;
      if (w <= 0) continue;
      const top = new TilingSprite({ texture: this.assets.groundTop, width: w, height: TOP_H });
      top.tileScale.set(GS);
      top.position.set(seg.x0, GROUND_Y);
      this.root.addChild(top);
      const fillH = VIEW_H - GROUND_Y - TOP_H + 40;
      if (fillH > 0) {
        const fill = new TilingSprite({ texture: this.assets.groundFill, width: w, height: fillH });
        fill.tileScale.set(GS);
        fill.position.set(seg.x0, GROUND_Y + TOP_H);
        this.root.addChild(fill);
      }
      const lip = new Graphics();
      lip.rect(0, 0, w, 3).fill({ color: 0xd9ffb0, alpha: 0.35 });
      lip.position.set(seg.x0, GROUND_Y - 1);
      this.root.addChild(lip);
    }

    // 浮空平台 / 碎裂板 / 倒挂天花板跑道
    track.plats.forEach((p, idx) => {
      if (p.inverted) {
        // 倒挂天花板跑道
        const pts = new TilingSprite({
          texture: this.assets.platformLong,
          width: p.w,
          height: 22,
        });
        pts.tileScale.set(22 / 16);
        pts.scale.y = -1;
        pts.position.set(p.x, p.y + 11);
        this.root.addChild(pts);
        const edge = new Graphics();
        edge.roundRect(-2, 0, p.w + 4, 24, 6).stroke({ width: 2, color: 0x6366f1 });
        edge.position.set(p.x, p.y - 12);
        this.root.addChild(edge);
        return;
      }
      if (p.crumble) {
        const g = new Container();
        const board = new TilingSprite({
          texture: this.assets.crate,
          width: p.w,
          height: 20,
        });
        board.tileScale.set(20 / 16);
        board.alpha = 0.96;
        g.addChild(board);
        const cracks = new Graphics();
        for (let cx = 14; cx < p.w; cx += 26) {
          cracks.moveTo(cx, -12).lineTo(cx + 4, -2).lineTo(cx - 2, 8).stroke({ width: 1.5, color: 0x2c1d0e });
        }
        cracks.roundRect(-2, -12, p.w + 4, 24, 5).stroke({ width: 2, color: 0x2c1d0e });
        g.addChild(cracks);
        g.position.set(p.x, p.y);
        this.crumbleSprites[idx] = g;
        this.root.addChild(g);
        return;
      }
      if (p.mover) return;
      const pts = new TilingSprite({
        texture: this.assets.platformLong,
        width: p.w,
        height: 22,
      });
      pts.tileScale.set(22 / 16);
      pts.position.set(p.x, p.y - 11);
      this.root.addChild(pts);
      const edge = new Graphics();
      edge.roundRect(-2, 0, p.w + 4, 24, 6).stroke({ width: 2, color: 0x3f2b16 });
      edge.position.set(p.x, p.y - 12);
      this.root.addChild(edge);
    });

    // 升降台
    track.plats.forEach((p, idx) => {
      if (!p.mover) {
        this.moverSprites[idx] = null;
        return;
      }
      const g = new Container();
      const board = new TilingSprite({
        texture: this.assets.platformLong,
        width: p.w,
        height: 22,
      });
      board.tileScale.set(22 / 16);
      board.position.set(0, -11);
      g.addChild(board);
      const rail = new Graphics();
      rail.roundRect(-2, 0, p.w + 4, 24, 6).stroke({ width: 2, color: 0x4a5a78 });
      for (const ax of [10, p.w - 10]) {
        rail.moveTo(ax - 5, -18).lineTo(ax, -24).lineTo(ax + 5, -18).stroke({ width: 2.5, color: 0x8fd3ff });
        rail.moveTo(ax - 5, 30).lineTo(ax, 36).lineTo(ax + 5, 30).stroke({ width: 2.5, color: 0x8fd3ff });
      }
      g.addChild(rail);
      g.position.set(p.x, p.y + moverOffsetY(p.mover, 0));
      this.moverSprites[idx] = g;
      this.root.addChild(g);
    });

    // 弹跳菇
    for (const pad of track.pads) {
      const stem = new Graphics();
      stem.roundRect(pad.x + pad.w / 2 - 7, GROUND_Y - 16, 14, 16, 4).fill(0xe8edf5);
      this.root.addChild(stem);
      const cap = new Graphics();
      cap
        .arc(0, 0, pad.w / 2 - 6, Math.PI, 0)
        .closePath()
        .fill({ color: 0x7ddf72 })
        .stroke({ width: 2.5, color: 0x3e8f4a });
      cap.circle(-pad.w * 0.18, -10, 5).fill(0xffffff);
      cap.circle(pad.w * 0.15, -13, 7).fill(0xffe08a);
      cap.position.set(pad.x + pad.w / 2, GROUND_Y - 14);
      this.padCaps.push(cap);
      this.root.addChild(cap);
    }

    // 尖刺 / 悬空双面致命刺梁
    for (const hz of track.hazards) {
      const isBar = hz.y + hz.h < GROUND_Y - 60;
      if (isBar) {
        const beam = new Graphics();
        beam.roundRect(hz.x, hz.y, hz.w, hz.h, 3).fill(0x1e2432);
        for (let ix = hz.x; ix < hz.x + hz.w; ix += 20) {
          beam.poly([
            { x: ix, y: hz.y },
            { x: Math.min(ix + 10, hz.x + hz.w), y: hz.y },
            { x: Math.min(ix + 18, hz.x + hz.w), y: hz.y + hz.h },
            { x: Math.min(ix + 8, hz.x + hz.w), y: hz.y + hz.h },
          ]).fill(0xf59e0b);
        }
        for (let tx = hz.x + 4; tx < hz.x + hz.w - 12; tx += SPIKE_W) {
          beam
            .moveTo(tx, hz.y)
            .lineTo(tx + SPIKE_W / 2, hz.y - 12)
            .lineTo(tx + SPIKE_W, hz.y)
            .closePath()
            .fill(0xc5d0e0)
            .stroke({ width: 1.5, color: 0x1e293b });
          beam.moveTo(tx + 2, hz.y).lineTo(tx + SPIKE_W / 2, hz.y - 10).stroke({ width: 1, color: 0xffffff });
        }
        for (let tx = hz.x + 4; tx < hz.x + hz.w - 12; tx += SPIKE_W) {
          beam
            .moveTo(tx, hz.y + hz.h)
            .lineTo(tx + SPIKE_W / 2, hz.y + hz.h + 12)
            .lineTo(tx + SPIKE_W, hz.y + hz.h)
            .closePath()
            .fill(0xc5d0e0)
            .stroke({ width: 1.5, color: 0x1e293b });
          beam.moveTo(tx + 2, hz.y + hz.h).lineTo(tx + SPIKE_W / 2, hz.y + hz.h + 10).stroke({ width: 1, color: 0xffffff });
        }
        beam.rect(hz.x - 2, hz.y, 4, hz.h).fill(0xdc2626);
        beam.rect(hz.x + hz.w - 2, hz.y, 4, hz.h).fill(0xdc2626);
        beam.circle(hz.x + hz.w / 2, hz.y + hz.h / 2, 5).fill(0xef4444);
        beam.circle(hz.x + hz.w / 2, hz.y + hz.h / 2, 2.5).fill(0xffffff);
        this.root.addChild(beam);
        continue;
      }
      const units = Math.round(hz.w / SPIKE_W);
      for (let i = 0; i < units; i++) {
        const s = new Sprite(this.assets.spike);
        s.position.set(hz.x + i * SPIKE_W, hz.y);
        this.root.addChild(s);
      }
      const base = new Graphics();
      base.rect(hz.x - 2, hz.y + hz.h - 4, hz.w + 4, 5).fill(0x39404e);
      this.root.addChild(base);
    }

    // 收集品：宝石
    for (const c of track.coins) {
      const s = new Sprite(this.assets.gemFrames[0]!);
      s.anchor.set(0.5);
      s.scale.set(1.15 * (26 / 22));
      s.position.set(c.x, c.y);
      this.coinSprites.push(s);
      this.root.addChild(s);
    }

    // 重力翻转门
    if (track.portals) {
      for (const pt of track.portals) {
        const root = new Container();
        const vortex = new Graphics();
        const isUp = pt.targetGravDir === -1;
        vortex.ellipse(0, 0, pt.w / 2 + 6, pt.h / 2 + 6).stroke({
          width: 3,
          color: isUp ? 0xc084fc : 0x38bdf8,
          alpha: 0.9,
        });
        vortex.ellipse(0, 0, pt.w / 2, pt.h / 2).fill({
          color: isUp ? 0x581c87 : 0x075985,
          alpha: 0.65,
        });
        const arr = new Graphics();
        if (isUp) {
          arr.moveTo(-7, 8).lineTo(0, -10).lineTo(7, 8).stroke({ width: 3, color: 0xffffff });
        } else {
          arr.moveTo(-7, -8).lineTo(0, 10).lineTo(7, -8).stroke({ width: 3, color: 0xffffff });
        }
        root.addChild(vortex, arr);
        root.position.set(pt.x + pt.w / 2, pt.y + pt.h / 2);
        this.portalSprites.push(root);
        this.root.addChild(root);
      }
    }

    // 护盾道具
    if (track.shields) {
      for (const sh of track.shields) {
        const root = new Container();
        const star = new Graphics();
        star.circle(0, 0, 15).fill({ color: 0x0284c7, alpha: 0.7 }).stroke({ width: 2.2, color: 0x38bdf8 });
        star.circle(0, 0, 8).fill(0xffffff);
        root.addChild(star);
        root.position.set(sh.x, sh.y);
        this.shieldSprites.push(root);
        this.root.addChild(root);
      }
    }

    // 磁铁道具
    if (track.magnets) {
      for (const mg of track.magnets) {
        const root = new Container();
        const mag = new Graphics();
        mag.circle(0, 0, 15).fill({ color: 0xb45309, alpha: 0.7 }).stroke({ width: 2.2, color: 0xfbbf24 });
        mag.circle(0, 0, 8).fill(0xfef08a);
        root.addChild(mag);
        root.position.set(mg.x, mg.y);
        this.magnetSprites.push(root);
        this.root.addChild(root);
      }
    }

    // 加速带
    for (const z of track.boosts) {
      const root = new Container();
      const base = new Graphics();
      base.rect(z.x, GROUND_Y - 6, z.w, 6).fill({ color: 0xffd23f, alpha: 0.28 });
      base.rect(z.x, GROUND_Y - 2, z.w, 2).fill({ color: 0xffe08a, alpha: 0.85 });
      root.addChild(base);
      const chevrons: Graphics[] = [];
      const bx: number[] = [];
      for (let i = 0; i < Math.floor(z.w / 44); i++) {
        const ch = new Graphics();
        ch.moveTo(-10, -22).lineTo(0, -12).lineTo(-10, -2).stroke({ width: 3.5, color: 0xffd23f, alpha: 0.9 });
        chevrons.push(ch);
        bx.push(22 + i * 44);
        root.addChild(ch);
      }
      this.boostFx.push({ chevrons, bx, zx: z.x, zw: z.w });
      this.root.addChild(root);
    }

    // 横扫钉球
    for (const pd of track.pendulums) {
      const g = new Container();
      const body = new Graphics();
      body.circle(0, 0, pd.r).fill({ color: 0xb3403a }).stroke({ width: 3, color: 0x5c1d1a });
      for (let k = 0; k < 8; k++) {
        const a = (Math.PI * 2 * k) / 8;
        body.moveTo(Math.cos(a) * (pd.r - 2), Math.sin(a) * (pd.r - 2))
          .lineTo(Math.cos(a) * (pd.r + 8), Math.sin(a) * (pd.r + 8))
          .stroke({ width: 3.5, color: 0xd8d8e2 });
      }
      body.circle(0, 0, pd.r * 0.5).fill({ color: 0xffd23f, alpha: 0.85 });
      g.addChild(body);
      g.position.set(pd.x0, pd.highY);
      this.pendulumSprites.push(g);
      this.root.addChild(g);
      const chain = new Graphics();
      this.pendulumChains.push(chain);
      this.root.addChild(chain);
    }

    // 二段跳环
    for (const rg of track.rings) {
      const g = new Container();
      const glow = new Sprite(this.assets.glow);
      glow.anchor.set(0.5);
      glow.tint = 0xffd23f;
      glow.alpha = 0.55;
      glow.scale.set(0.5);
      g.addChild(glow);
      const ring = new Graphics();
      ring.circle(0, 0, 18).stroke({ width: 4.5, color: 0xffd23f });
      ring.circle(0, 0, 14).stroke({ width: 1.5, color: 0xffffff, alpha: 0.85 });
      g.addChild(ring);
      g.position.set(rg.x, rg.y);
      this.ringSprites.push(g);
      this.root.addChild(g);
    }

    // 上升气流柱
    if (track.winds) {
      for (const wz of track.winds) {
        const root = new Container();
        const bg = new Graphics();
        bg.rect(wz.x, GROUND_Y - wz.h, wz.w, wz.h).fill({ color: 0x48cae4, alpha: 0.12 });
        bg.rect(wz.x, GROUND_Y - wz.h, 2, wz.h).fill({ color: 0x90e0ef, alpha: 0.45 });
        bg.rect(wz.x + wz.w - 2, GROUND_Y - wz.h, 2, wz.h).fill({ color: 0x90e0ef, alpha: 0.45 });
        root.addChild(bg);
        const streamG = new Graphics();
        root.addChild(streamG);
        this.windStreams.push({ g: streamG, x: wz.x, w: wz.w, h: wz.h });
        this.root.addChild(root);
      }
    }

    // 激光闸门
    if (track.gates) {
      for (const gt of track.gates) {
        const root = new Container();
        const posts = new Graphics();
        posts.roundRect(gt.x - 3, GROUND_Y - 8, gt.w + 6, 10, 3).fill(0x364052).stroke({ width: 1.5, color: 0x1a212e });
        posts.roundRect(gt.x - 3, gt.y - 2, gt.w + 6, 10, 3).fill(0x364052).stroke({ width: 1.5, color: 0x1a212e });
        root.addChild(posts);
        const diode = new Graphics();
        root.addChild(diode);
        this.gateDiodes.push(diode);
        const beam = new Graphics();
        root.addChild(beam);
        this.gateBeams.push(beam);
        this.root.addChild(root);
      }
    }

    // 终点旗
    const pole = new Graphics();
    pole.rect(track.finishX - 3, GROUND_Y - 176, 6, 176).fill(0xe8edf5);
    pole.circle(track.finishX, GROUND_Y - 178, 6).fill(0xffd23f);
    pole.circle(track.finishX, GROUND_Y - 178, 10).fill({ color: 0xffd23f, alpha: 0.25 });
    this.root.addChild(pole);
    const cloth = new Sprite(this.assets.flagCloth);
    cloth.anchor.set(0, 0.1);
    cloth.position.set(track.finishX + 2, GROUND_Y - 172);
    cloth.scale.set(0.9);
    this.flagCloth = cloth;
    this.root.addChild(cloth);

    // 地面装饰
    const r = splitmix32(Number(track.finishX));
    const tufts = new Graphics();
    for (const seg of track.grounds) {
      const props: Array<[Texture, number]> = [
        [this.assets.rock, 0.9],
        [this.assets.bush, 1.15],
        [this.assets.shrooms, 1],
      ];
      const isPadZone = (x: number): boolean =>
        track.pads.some((p) => x > p.x - 30 && x < p.x + p.w + 30);
      let x = seg.x0 + 40 + r() * 140;
      while (x < seg.x1 - 36) {
        const h = 7 + r() * 9;
        tufts.moveTo(x, GROUND_Y).lineTo(x + 3.5, GROUND_Y - h).lineTo(x + 7, GROUND_Y).fill({ color: 0x8fce56, alpha: 0.85 });
        if (!isPadZone(x) && r() < 0.55) {
          const [tex, sc] = props[Math.floor(r() * props.length)]!;
          const s = new Sprite(tex);
          s.anchor.set(0.5, 1);
          s.scale.set(sc * (0.85 + r() * 0.3));
          s.position.set(x + 20 + r() * 30, GROUND_Y + 2);
          this.root.addChild(s);
        }
        x += 90 + r() * 150;
      }
    }
    this.root.addChild(tufts);
  }

  onCoin(index: number): void {
    const s = this.coinSprites[index];
    if (s) s.visible = false;
  }

  onShield(index: number): void {
    const s = this.shieldSprites[index];
    if (s) s.visible = false;
  }

  onMagnet(index: number): void {
    const s = this.magnetSprites[index];
    if (s) s.visible = false;
  }

  setCrumbles(broken: readonly number[]): void {
    for (const i of broken) {
      if (this.brokenPlats.has(i)) continue;
      this.brokenPlats.add(i);
      const s = this.crumbleSprites[i];
      if (s) s.visible = false;
    }
  }

  setTick(tick: number, camX?: number): void {
    this.simTick = tick;
    const t = this.track;
    if (!t) return;
    const minX = camX !== undefined ? camX - 120 : -Infinity;
    const maxX = camX !== undefined ? camX + VIEW_W + 120 : Infinity;

    for (let i = 0; i < t.plats.length; i++) {
      const p = t.plats[i]!;
      if (p.x + p.w < minX || p.x > maxX) continue;
      const sp = this.moverSprites[i];
      if (p.mover && sp) sp.y = p.y + moverOffsetY(p.mover, tick);
    }
    for (let i = 0; i < t.pendulums.length; i++) {
      const pd = t.pendulums[i]!;
      if (pd.x1 < minX || pd.x0 > maxX) continue;
      const g = this.pendulumSprites[i];
      if (!g) continue;
      const bob = pendulumBob(pd, tick);
      g.position.set(bob.x, bob.y);
      const chain = this.pendulumChains[i]!;
      if (chain) {
        chain.clear();
        const ax = (pd.x0 + pd.x1) / 2;
        const ay = pd.highY - (pd.highY - pd.lowY) - 60;
        chain.moveTo(bob.x, bob.y).lineTo(ax, ay).stroke({ width: 2.5, color: 0x6d7a92, alpha: 0.85 });
      }
    }
    if (t.gates) {
      for (let i = 0; i < t.gates.length; i++) {
        const gt = t.gates[i]!;
        if (gt.x + gt.w < minX || gt.x > maxX) continue;
        const active = isGateActive(gt, tick);
        const beam = this.gateBeams[i];
        const diode = this.gateDiodes[i];
        if (diode) {
          diode.clear();
          diode.circle(gt.x + gt.w / 2, GROUND_Y - 3, 3).fill(active ? 0xff4d6d : 0x52b788);
          diode.circle(gt.x + gt.w / 2, gt.y + 3, 3).fill(active ? 0xff4d6d : 0x52b788);
        }
        if (beam) {
          beam.clear();
          if (active) {
            beam.rect(gt.x + 2, gt.y + 6, gt.w - 4, gt.h - 12).fill({ color: 0xff2a55, alpha: 0.75 });
            beam.rect(gt.x + 5, gt.y + 6, gt.w - 10, gt.h - 12).fill({ color: 0xffffff, alpha: 0.95 });
            beam.rect(gt.x - 2, gt.y + 6, gt.w + 4, gt.h - 12).fill({ color: 0xff758f, alpha: 0.35 });
          } else {
            beam.rect(gt.x + gt.w / 2 - 1, gt.y + 6, 2, gt.h - 12).fill({ color: 0x52b788, alpha: 0.15 });
          }
        }
      }
    }
  }

  setRingsGot(got: readonly number[]): void {
    for (const i of got) {
      if (this.ringsGotSet.has(i)) continue;
      this.ringsGotSet.add(i);
      this.ringSprites[i]!.visible = false;
    }
  }

  getCrumbleCenter(index: number): { x: number; y: number } | null {
    const p = this.track?.plats[index];
    return p ? { x: p.x + p.w / 2, y: p.y } : null;
  }

  getCoinPoint(index: number): { x: number; y: number } | null {
    const c = this.track?.coins[index];
    return c ? { x: c.x, y: c.y } : null;
  }

  getRingPoint(index: number): { x: number; y: number } | null {
    const rg = this.track?.rings[index];
    return rg ? { x: rg.x, y: rg.y } : null;
  }

  surfaceYBelow(x: number, fromY: number): number | null {
    const t = this.track;
    if (!t) return null;
    let best: number | null = null;
    const half = 8;
    for (const s of t.grounds) {
      if (x + half < s.x0 || x - half > s.x1) continue;
      if (GROUND_Y >= fromY && (best === null || GROUND_Y < best)) best = GROUND_Y;
    }
    for (const p of t.plats) {
      if (p.inverted) continue;
      if (x < p.x || x > p.x + p.w) continue;
      const py = p.mover ? p.y + moverOffsetY(p.mover, this.simTick) : p.y;
      if (py >= fromY - 4 && (best === null || py < best)) best = py;
    }
    return best;
  }

  update(tSec: number, camX?: number): void {
    const t = this.track;
    const minX = camX !== undefined ? camX - 120 : -Infinity;
    const maxX = camX !== undefined ? camX + VIEW_W + 120 : Infinity;

    // 宝石动画（视口裁剪）
    for (let i = 0; i < this.coinSprites.length; i++) {
      const s = this.coinSprites[i]!;
      if (!s.visible) continue;
      if (t && t.coins[i] && (t.coins[i]!.x < minX || t.coins[i]!.x > maxX)) continue;
      s.texture = this.assets.gemFrames[Math.floor(tSec * 8 + i) % 4]!;
      s.y += Math.sin(tSec * 2.6 + i) * 0.18;
    }
    // 二段跳环
    for (let i = 0; i < this.ringSprites.length; i++) {
      const g = this.ringSprites[i]!;
      if (!g.visible) continue;
      if (t && t.rings[i] && (t.rings[i]!.x < minX || t.rings[i]!.x > maxX)) continue;
      const k = 1 + Math.sin(tSec * 3.2 + i * 1.7) * 0.08;
      g.scale.set(k);
      g.rotation = Math.sin(tSec * 1.4 + i) * 0.12;
    }
    // 重力门漩涡
    for (let i = 0; i < this.portalSprites.length; i++) {
      const pt = this.portalSprites[i]!;
      if (t && t.portals[i] && (t.portals[i]!.x < minX || t.portals[i]!.x > maxX)) continue;
      pt.scale.set(1 + Math.sin(tSec * 4 + i) * 0.06);
    }
    // 护盾星
    for (let i = 0; i < this.shieldSprites.length; i++) {
      const sh = this.shieldSprites[i]!;
      if (!sh.visible) continue;
      if (t && t.shields[i] && (t.shields[i]!.x < minX || t.shields[i]!.x > maxX)) continue;
      sh.rotation += 0.04;
      sh.scale.set(1 + Math.sin(tSec * 3.5 + i) * 0.1);
    }
    // 磁铁
    for (let i = 0; i < this.magnetSprites.length; i++) {
      const mg = this.magnetSprites[i]!;
      if (!mg.visible) continue;
      if (t && t.magnets[i] && (t.magnets[i]!.x < minX || t.magnets[i]!.x > maxX)) continue;
      mg.scale.set(1 + Math.sin(tSec * 4 + i) * 0.12);
    }
    // 弹跳菇呼吸
    for (let i = 0; i < this.padCaps.length; i++) {
      const cap = this.padCaps[i]!;
      if (t && t.pads[i] && (t.pads[i]!.x + t.pads[i]!.w < minX || t.pads[i]!.x > maxX)) continue;
      const k = 1 + Math.sin(tSec * 4.2 + i * 0.9) * 0.06;
      cap.scale.set(k, 2 - k);
    }
    // 终点旗飘动
    if (this.flagCloth && t && (t.finishX >= minX && t.finishX <= maxX + 200)) {
      this.flagCloth.skew.y = Math.sin(tSec * 5.4) * 0.18;
      this.flagCloth.scale.x = 0.9 + Math.sin(tSec * 3.2) * 0.06;
    }
    // 加速带箭头向右滚动
    for (const b of this.boostFx) {
      if (b.zx + b.zw < minX || b.zx > maxX) continue;
      const offset = (tSec * 160) % 44;
      for (let i = 0; i < b.chevrons.length; i++) {
        const ch = b.chevrons[i]!;
        const rawX = b.bx[i]! + offset;
        const lx = ((rawX % b.zw) + b.zw) % b.zw;
        ch.position.set(b.zx + lx, GROUND_Y);
      }
    }
    // 气流柱向上飘动的气流粒子线
    for (let i = 0; i < this.windStreams.length; i++) {
      const ws = this.windStreams[i]!;
      if (ws.x + ws.w < minX || ws.x > maxX) continue;
      const g = ws.g;
      g.clear();
      const n = 6;
      for (let j = 0; j < n; j++) {
        const streamX = ws.x + 12 + j * ((ws.w - 24) / (n - 1));
        const streamPhase = (tSec * 140 + j * 45) % ws.h;
        const lineY = GROUND_Y - streamPhase;
        g.moveTo(streamX, lineY)
          .lineTo(streamX, Math.max(GROUND_Y - ws.h, lineY - 24))
          .stroke({ width: 2.2, color: 0x90e0ef, alpha: 0.65 });
      }
    }
  }
}
