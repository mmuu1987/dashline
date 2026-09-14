import { Container, Graphics, Sprite, TilingSprite, type Texture } from 'pixi.js';
import { GROUND_Y, SPIKE_W, isGateActive, moverOffsetY, pendulumBob, type Track } from '@dashline/core';
import { splitmix32 } from '@dashline/shared';
import { ART_SCALE, VIEW_H, VIEW_W } from './consts.js';
import type { GameAssets } from './textures.js';

/**
 * 平台厚度：受关卡设计约束（chunks.ts 里平台离地最低 24px、层间 42px），
 * 所以平台不能按 16px 整格缩放，只能保持薄板观感；缩放倍率只统一地面/道具/宝石。
 */
const PLAT_H = 22;
const CRUMBLE_H = 20;

export class WorldView {
  readonly root = new Container();

  private coinSprites: Sprite[] = [];
  private flagCloth: Sprite | null = null;
  private track: Track | null = null;
  /** 弹跳菇（用于呼吸脉冲） */
  private padCaps: Sprite[] = [];
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
    this.root.removeChildren().forEach((c) => c.destroy({ children: true }));
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

    // 坑底暗色。
    // 地面高度可变之后不能再画成"从 GROUND_Y 开始的一条通栏"：
    // 谷地（y > GROUND_Y）上方会被这条暗色盖住，看起来像一条横贯屏幕的黑带。
    // 改为「全局底色从最低地面开始」+「每个坑单独补一块到本处地面」。
    const gsSorted = [...track.grounds].sort((a, b) => a.x0 - b.x0);
    const deepestY = gsSorted.reduce((m, g) => Math.max(m, g.y), GROUND_Y);
    const bottomY = VIEW_H + 80;
    const backdrop = new Graphics();
    backdrop
      .rect(-400, deepestY, track.length + 800, bottomY - deepestY)
      .fill(0x91bab0);
    for (let i = 0; i + 1 < gsSorted.length; i++) {
      const a = gsSorted[i]!;
      const b = gsSorted[i + 1]!;
      const gapW = b.x0 - a.x1;
      if (gapW <= 0) continue;
      // 坑口取两侧较低的那个面（y 越大越低），向下补暗色
      const lip = Math.max(a.y, b.y);
      if (lip >= deepestY) continue; // 已在全局底色覆盖范围内
      backdrop.rect(a.x1, lip, gapW, bottomY - lip).fill(0x91bab0);
    }
    this.root.addChild(backdrop);

    // 地面段：草顶行 + 泥土填充（统一 ART_SCALE，草皮由 3 变体拼接）
    const GS = ART_SCALE;
    const TOP_H = GS * this.assets.groundTop.height;
    for (const seg of track.grounds) {
      const w = seg.x1 - seg.x0;
      if (w <= 0) continue;
      const top = new TilingSprite({ texture: this.assets.groundTop, width: w, height: TOP_H });
      top.tileScale.set(GS);
      top.tilePosition.x = -seg.x0;
      top.position.set(seg.x0, seg.y);
      this.root.addChild(top);
      const fillH = VIEW_H - seg.y - TOP_H + 40;
      if (fillH > 0) {
        const fill = new TilingSprite({ texture: this.assets.groundFill, width: w, height: fillH });
        fill.tileScale.set(GS);
        fill.tilePosition.x = -seg.x0;
        fill.position.set(seg.x0, seg.y + TOP_H);
        this.root.addChild(fill);
      }
      const lip = new Graphics();
      lip.rect(0, 0, w, 2).fill({ color: 0x243c46, alpha: 0.75 });
      lip.position.set(seg.x0, seg.y - 1);
      this.root.addChild(lip);
    }

    // 浮空平台 / 碎裂板 / 倒挂天花板跑道
    track.plats.forEach((p, idx) => {
      if (p.inverted) {
        // 倒挂天花板跑道：板身挂在判定面之上（玩家从下方踩）
        const pts = new TilingSprite({
          texture: this.assets.platformLong,
          width: p.w,
          height: PLAT_H,
        });
        pts.tileScale.set(PLAT_H / this.assets.platformLong.height);
        pts.scale.y = -1;
        pts.position.set(p.x, p.y);
        this.root.addChild(pts);
        const edge = new Graphics();
        edge.roundRect(-2, 0, p.w + 4, PLAT_H + 2, 6).stroke({ width: 2, color: 0x6366f1 });
        edge.position.set(p.x, p.y - PLAT_H - 2);
        this.root.addChild(edge);
        return;
      }
      if (p.crumble) {
        const g = new Container();
        const board = new TilingSprite({
          texture: this.assets.crate,
          width: p.w,
          height: CRUMBLE_H,
        });
        board.tileScale.set(CRUMBLE_H / this.assets.crate.height);
        board.alpha = 0.96;
        g.addChild(board);
        const cracks = new Graphics();
        for (let cx = 14; cx < p.w; cx += 26) {
          cracks.moveTo(cx, 0).lineTo(cx + 4, 10).lineTo(cx - 2, CRUMBLE_H).stroke({ width: 1.5, color: 0x2c1d0e });
        }
        cracks.roundRect(-2, 0, p.w + 4, CRUMBLE_H, 5).stroke({ width: 2, color: 0x2c1d0e });
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
        height: PLAT_H,
      });
      pts.tileScale.set(PLAT_H / this.assets.platformLong.height);
      pts.position.set(p.x, p.y);
      this.root.addChild(pts);
      const edge = new Graphics();
      edge.roundRect(-2, 0, p.w + 4, PLAT_H + 2, 6).stroke({ width: 2, color: 0x3f2b16 });
      edge.position.set(p.x, p.y - 2);
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
        height: PLAT_H,
      });
      board.tileScale.set(PLAT_H / this.assets.platformLong.height);
      board.position.set(0, 0);
      g.addChild(board);
      const rail = new Graphics();
      rail.roundRect(-2, 0, p.w + 4, PLAT_H + 2, 6).stroke({ width: 2, color: 0x4a5a78 });
      for (const ax of [10, p.w - 10]) {
        rail.moveTo(ax - 5, -18).lineTo(ax, -24).lineTo(ax + 5, -18).stroke({ width: 2.5, color: 0x8fd3ff });
        rail.moveTo(ax - 5, 30).lineTo(ax, 36).lineTo(ax + 5, 30).stroke({ width: 2.5, color: 0x8fd3ff });
      }
      g.addChild(rail);
      g.position.set(p.x, p.y + moverOffsetY(p.mover, 0));
      this.moverSprites[idx] = g;
      this.root.addChild(g);
    });

    // 弹跳菇（贴合所在地面段高度）
    for (const pad of track.pads) {
      const py = this.terrainTopAt(pad.x + pad.w / 2);
      const cap = new Sprite(this.assets.spring);
      cap.anchor.set(0.5, 1);
      cap.width = pad.w;
      cap.height = 26;
      cap.position.set(pad.x + pad.w / 2, py);
      this.padCaps.push(cap);
      this.root.addChild(cap);
    }

    // 尖刺 / 悬空双面致命刺梁
    for (const hz of track.hazards) {
      // 用所在地面高度判断：地面刺贴着地形，悬空刺梁离地很高
      const isBar = hz.y + hz.h < this.terrainTopAt(hz.x) - 60;
      if (isBar) {
        const beam = new TilingSprite({ texture: this.assets.warning, width: hz.w, height: hz.h });
        beam.tileScale.set(hz.h / this.assets.warning.height);
        beam.position.set(hz.x, hz.y);
        this.root.addChild(beam);
        const units = Math.max(1, Math.round(hz.w / 40));
        for (let i = 0; i < units; i++) {
          for (const direction of [-1, 1]) {
            const teeth = new Sprite(this.assets.spike);
            teeth.width = hz.w / units;
            teeth.height = 12;
            teeth.position.set(hz.x + i * hz.w / units, direction === -1 ? hz.y - 12 : hz.y + hz.h + 12);
            if (direction === 1) teeth.scale.y *= -1;
            this.root.addChild(teeth);
          }
        }
        continue;
      }
      const units = Math.max(1, Math.round(hz.w / (SPIKE_W * 2)));
      for (let i = 0; i < units; i++) {
        const s = new Sprite(this.assets.spike);
        s.width = hz.w / units;
        s.height = hz.h;
        s.position.set(hz.x + i * hz.w / units, hz.y);
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
      s.scale.set(ART_SCALE);
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
        vortex.roundRect(-pt.w / 2 - 4, -pt.h / 2 - 4, pt.w + 8, pt.h + 8, 14)
          .fill({ color: isUp ? 0xe8def4 : 0xd4eef1, alpha: 0.72 })
          .stroke({ width: 3, color: isUp ? 0x8a71ab : 0x4d9197 });
        const arr = new Sprite(this.assets.arrowUp);
        arr.anchor.set(0.5);
        arr.width = arr.height = 22;
        if (!isUp) arr.rotation = Math.PI;
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
        const badge = new Graphics().circle(0, 0, 17).fill(0xd5f1fa).stroke({ width: 2, color: 0x356778 });
        const icon = new Sprite(this.assets.shield);
        icon.anchor.set(0.5);
        icon.width = icon.height = 21;
        root.addChild(badge, icon);
        root.position.set(sh.x, sh.y);
        this.shieldSprites.push(root);
        this.root.addChild(root);
      }
    }

    // 磁铁道具
    if (track.magnets) {
      for (const mg of track.magnets) {
        const root = new Container();
        const badge = new Graphics().circle(0, 0, 17).fill(0xffe6ad).stroke({ width: 2, color: 0x84602b });
        const icon = new Sprite(this.assets.magnet);
        icon.anchor.set(0.5);
        icon.width = icon.height = 21;
        root.addChild(badge, icon);
        root.position.set(mg.x, mg.y);
        this.magnetSprites.push(root);
        this.root.addChild(root);
      }
    }

    // 加速带（贴合所在地面高度）
    for (const z of track.boosts) {
      const zy = this.terrainTopAt(z.x + z.w / 2);
      const root = new Container();
      const base = new Graphics();
      base.roundRect(z.x, zy - 8, z.w, 8, 3).fill(0xf4c75d).stroke({ color: 0x92732f, width: 1.5 });
      const belt = new TilingSprite({ texture: this.assets.conveyor, width: z.w, height: 10 });
      belt.tileScale.set(0.16);
      belt.position.set(z.x, zy);
      root.addChild(base, belt);
      const chevrons: Graphics[] = [];
      const bx: number[] = [];
      for (let i = 0; i < Math.floor(z.w / 44); i++) {
        const ch = new Graphics();
        ch.moveTo(-10, -22).lineTo(0, -12).lineTo(-10, -2).stroke({ width: 3.5, color: 0xa6751b, alpha: 0.9 });
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
      const body = new Sprite(this.assets.saw);
      body.anchor.set(0.5);
      body.width = body.height = pd.r * 2;
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
      const ring = new Graphics();
      ring.circle(0, 0, 18).fill({ color: 0xfff2c4, alpha: 0.6 }).stroke({ width: 3, color: 0xba8a32 });
      const star = new Sprite(this.assets.star);
      star.anchor.set(0.5);
      star.width = star.height = 23;
      g.addChild(ring, star);
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
        for (const y of [GROUND_Y - 8, gt.y - 2]) {
          const post = new TilingSprite({ texture: this.assets.warning, width: gt.w + 6, height: 10 });
          post.tileScale.set(0.12);
          post.position.set(gt.x - 3, y);
          root.addChild(post);
        }
        const diode = new Graphics();
        root.addChild(diode);
        this.gateDiodes.push(diode);
        const beam = new Graphics();
        root.addChild(beam);
        this.gateBeams.push(beam);
        this.root.addChild(root);
      }
    }

    // Kenney 终点旗已包含旗杆；基底贴合真实地面。
    const cloth = new Sprite(this.assets.flagCloth);
    cloth.anchor.set(0, 1);
    cloth.position.set(track.finishX, this.terrainTopAt(track.finishX));
    cloth.width = cloth.height = 146;
    this.flagCloth = cloth;
    this.root.addChild(cloth);

    // 装饰始终在可交互物后方；不再把无碰撞木箱伪装成障碍物。
    const decorations = new Container();
    this.root.addChildAt(decorations, 1);
    const r = splitmix32(Number(track.finishX));
    const bigProps: Texture[] = [this.assets.rock, this.assets.bush];
    for (const seg of track.grounds) {
      const isPadZone = (x: number): boolean =>
        track.pads.some((p) => x > p.x - 30 && x < p.x + p.w + 30);
      const isBoostZone = (x: number): boolean =>
        track.boosts.some((z) => x > z.x - 40 && x < z.x + z.w + 40);
      let x = seg.x0 + 36 + r() * 90;
      while (x < seg.x1 - 36) {
        const free = !isPadZone(x) && !isBoostZone(x);
        if (free) {
          const decor = this.assets.groundDecor[Math.floor(r() * this.assets.groundDecor.length)]!;
          const d = new Sprite(decor);
          d.anchor.set(0.5, 1);
          d.scale.set(ART_SCALE);
          d.position.set(x, seg.y + 3);
          decorations.addChild(d);
          // 偶发放置大件道具，避免小块装饰铺满整条跑道
          if (r() < 0.3) {
            const s = new Sprite(bigProps[Math.floor(r() * bigProps.length)]!);
            s.anchor.set(0.5, 1);
            s.scale.set(ART_SCALE);
            const propX = Math.min(seg.x1 - 24, x + 54 + r() * 40);
            s.position.set(propX, seg.y + 3);
            s.alpha = 0.78;
            decorations.addChild(s);
          }
        }
        x += 130 + r() * 190;
      }
    }
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

  /** 将可收集物和碎裂物的视觉状态精确同步到模拟快照，支持检查点回退。 */
  restoreDynamicState(state: {
    coinsGot: readonly number[];
    crumblesBroken: readonly number[];
    ringsGot: readonly number[];
    shieldsGot: readonly number[];
    magnetsGot: readonly number[];
  }): void {
    const coins = new Set(state.coinsGot);
    const broken = new Set(state.crumblesBroken);
    const rings = new Set(state.ringsGot);
    const shields = new Set(state.shieldsGot);
    const magnets = new Set(state.magnetsGot);
    this.coinSprites.forEach((sprite, i) => { sprite.visible = !coins.has(i); });
    this.crumbleSprites.forEach((sprite, i) => { if (sprite) sprite.visible = !broken.has(i); });
    this.ringSprites.forEach((sprite, i) => { sprite.visible = !rings.has(i); });
    this.shieldSprites.forEach((sprite, i) => { sprite.visible = !shields.has(i); });
    this.magnetSprites.forEach((sprite, i) => { sprite.visible = !magnets.has(i); });
    this.brokenPlats = broken;
    this.ringsGotSet = rings;
    this.shieldsGotSet = shields;
    this.magnetsGotSet = magnets;
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

  /** x 处的地面顶面 y；不在任何地面段上时回退到基准高度 */
  terrainTopAt(x: number): number {
    const t = this.track;
    if (!t) return GROUND_Y;
    let best: number | null = null;
    for (const s of t.grounds) {
      if (x < s.x0 || x > s.x1) continue;
      if (best === null || Math.abs(s.y - GROUND_Y) < Math.abs(best - GROUND_Y)) best = s.y;
    }
    return best ?? GROUND_Y;
  }

  surfaceYBelow(x: number, fromY: number): number | null {
    const t = this.track;
    if (!t) return null;
    let best: number | null = null;
    const half = 8;
    for (const s of t.grounds) {
      if (x + half < s.x0 || x - half > s.x1) continue;
      if (s.y >= fromY && (best === null || s.y < best)) best = s.y;
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
      const coin = t?.coins[i];
      if (!coin) continue;
      if (coin.x < minX || coin.x > maxX) continue;
      s.texture = this.assets.gemFrames[Math.floor(tSec * 8 + i) % this.assets.gemFrames.length]!;
      s.y = coin.y + Math.sin(tSec * 2.6 + i) * 4;
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
      sh.rotation = Math.sin(tSec * 2 + i) * 0.08;
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
      cap.width = (t?.pads[i]?.w ?? 48) * k;
      cap.height = 26 * (2 - k);
    }
    // 终点旗飘动
    if (this.flagCloth && t && (t.finishX >= minX && t.finishX <= maxX + 200)) {
      this.flagCloth.texture = this.assets.flagFrames[Math.floor(tSec * 5) % this.assets.flagFrames.length]!;
    }
    // 加速带箭头向右滚动
    for (const b of this.boostFx) {
      if (b.zx + b.zw < minX || b.zx > maxX) continue;
      const offset = (tSec * 160) % 44;
      for (let i = 0; i < b.chevrons.length; i++) {
        const ch = b.chevrons[i]!;
        const rawX = b.bx[i]! + offset;
        const lx = ((rawX % b.zw) + b.zw) % b.zw;
        ch.position.set(b.zx + lx, this.terrainTopAt(b.zx + lx));
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
