/**
 * 客户端主循环 —— 固定步长逻辑 + 渲染（60Hz rAF）。
 * 职责：装配 core/输入/渲染/HUD/音频/衣橱/成就，维护本地单机状态。
 */
import { Application } from 'pixi.js';
import {
  GROUND_Y,
  PLAYER_R,
  START_X,
  START_Y,
  createWorld,
  type SimEvent,
  type World,
} from '@dashline/core';
import { STEP_S, seedForDate, themeForSeed, todayUTC } from '@dashline/shared';
import { Sfx } from './audio.js';
import { loadBestRecord, saveBestRecord, type BestRecord } from './best-record.js';
import { Hud } from './hud.js';
import { InputBuffer } from './input.js';
import { calculateStreak, getDayRecord, saveDayRecord } from './meta.js';
import { GameView, VIEW_H, VIEW_W } from './render.js';
import { THEMES } from './render/background.js';
import { loadAssets } from './render/textures.js';
import { exportShareCard, renderShareCard } from './share-card.js';
import { Wardrobe } from './wardrobe.js';
import { Achievements } from './achievements.js';
import { Talents } from './talents.js';

const vibrate = (p: number | number[]): void => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(p);
    } catch {
      // ignore
    }
  }
};

type Phase = 'run' | 'dead' | 'done' | 'pause';

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    width: VIEW_W,
    height: VIEW_H,
    background: '#12141c',
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: false,
  });
  app.canvas.classList.add('game-canvas');
  document.getElementById('game')!.appendChild(app.canvas);

  const hud = new Hud();
  const sfx = new Sfx();
  const wardrobe = new Wardrobe();
  const achievements = new Achievements();
  const talents = new Talents();
  const assets = await loadAssets();

  // ---- 每日种子与主题 ----
  const dateStr = todayUTC();
  const seed = seedForDate(dateStr);
  const themeId = themeForSeed(seed);
  let streak = calculateStreak(dateStr);

  const view = new GameView(assets, themeId);
  view.setSkin(wardrobe.getEquippedSkin());
  app.stage.addChild(view.root);

  const input = new InputBuffer();
  input.attach(app.canvas);
  window.addEventListener('pointerdown', () => sfx.unlock());
  window.addEventListener('keydown', () => sfx.unlock());

  // 主题提示
  const currentTheme = THEMES[themeId] ?? THEMES[0]!;
  setTimeout(() => hud.toast(`🎨 今日主题：${currentTheme.name}`), 400);

  // ---- 静音按钮 ----
  const muteBtn = document.getElementById('btn-mute')!;
  muteBtn.textContent = sfx.isMuted() ? '🔇' : '🔊';
  muteBtn.addEventListener('click', () => {
    const muted = sfx.toggleMute();
    muteBtn.textContent = muted ? '🔇' : '🔊';
    if (!muted) sfx.unlock();
  });

  // ---- 暂停按钮与快捷键 ----
  const pauseBtn = document.getElementById('btn-pause')!;
  function togglePause(): void {
    if (phase === 'dead' || phase === 'done') return;
    input.resetHeld();
    if (phase === 'pause') {
      phase = 'run';
      hud.showPause(false);
      pauseBtn.textContent = '⏸';
      last = performance.now();
      acc = 0;
    } else {
      phase = 'pause';
      hud.showPause(true);
      pauseBtn.textContent = '▶';
    }
  }
  pauseBtn.addEventListener('click', togglePause);
  input.onPause(() => {
    if (!hud.isModalOpen()) togglePause();
  });

  function enterModal(): void {
    input.resetHeld();
    if (!hud.isModalOpen() && (phase === 'run' || phase === 'pause')) {
      modalReturnPhase = phase;
    }
    if (phase === 'run') {
      phase = 'pause';
    }
  }

  function exitModal(): void {
    input.resetHeld();
    const s = world.snapshot;
    if (!s.alive || s.finished || phase === 'done' || phase === 'dead') {
      phase = 'done';
      showResultPanel();
      return;
    }
    hud.hideResult();
    phase = modalReturnPhase;
    hud.showPause(phase === 'pause');
    pauseBtn.textContent = phase === 'pause' ? '▶' : '⏸';
    if (phase === 'run') {
      last = performance.now();
      acc = 0;
    }
  }

  // ---- 外观衣橱按钮 ----
  const wardrobeBtn = document.getElementById('btn-wardrobe')!;
  function openWardrobe(): void {
    enterModal();
    hud.showWardrobe(
      wardrobe.getAllSkins(),
      wardrobe.getTotalCoins(),
      wardrobe.getEquippedSkinId(),
      (id) => {
        const res = wardrobe.equipOrBuy(id);
        hud.toast(res.msg);
        if (res.ok) {
          view.setSkin(wardrobe.getEquippedSkin());
          openWardrobe();
        }
      },
      exitModal,
    );
  }
  wardrobeBtn.addEventListener('click', openWardrobe);

  // ---- 成就徽章按钮 ----
  const achBtn = document.getElementById('btn-achievements')!;
  function openAchievements(): void {
    enterModal();
    hud.showAchievements(achievements.getAll(), exitModal);
  }
  achBtn.addEventListener('click', openAchievements);

  // ---- 单机天赋强化按钮 ----
  const talentsBtn = document.getElementById('btn-talents')!;
  function openTalents(): void {
    enterModal();
    hud.showTalents(
      talents.getAll(),
      wardrobe.getTotalCoins(),
      (id) => {
        const res = talents.upgrade(id, wardrobe.getTotalCoins());
        if (res.ok) {
          wardrobe.deductCoins(res.cost);
          sfx.shield();
          vibrate([30, 20, 30]);
          hud.toast('⚡ 天赋升级成功！');
          openTalents();
        } else {
          hud.toast('宝石不足，多去跑道收集吧！');
        }
      },
      exitModal,
    );
  }
  talentsBtn.addEventListener('click', openTalents);

  // ---- 状态 ----
  let phase: Phase = 'run';
  let modalReturnPhase: 'run' | 'pause' = 'run';
  let attempts = getDayRecord(dateStr)?.attempts ?? 0;
  let deadUntil = 0;
  let world: World = createWorld(seed, talents.getPerksConfig());
  let best: BestRecord | null = loadBestRecord(dateStr);
  let usedShieldInRun = false;
  let nearMissCountInRun = 0;

  hud.setMode('纯单机模式');

  function fmtBest(b: BestRecord): string {
    return b.finished ? `${(b.timeMs / 1000).toFixed(2)}s` : `${b.distanceM}m`;
  }

  function resetAttempt(): void {
    world = createWorld(seed, talents.getPerksConfig());
    view.setTrack(world.track);
    view.resetCamera();
    view.resetAttemptFx(START_X, START_Y);
    attempts++;
    usedShieldInRun = false;
    nearMissCountInRun = 0;
    phase = 'run';
    hud.hideResult();
    hud.showPause(false);
    pauseBtn.textContent = '⏸';
    hud.setMeta(attempts, best ? fmtBest(best) : '--', streak);
  }

  input.onRestart(() => {
    if (phase !== 'dead') resetAttempt();
  });

  input.onAction(() => {
    if (phase === 'done') {
      input.resetHeld();
      resetAttempt();
    } else if (phase === 'pause' && !hud.isModalOpen()) {
      input.resetHeld();
      togglePause();
    }
  });

  window.addEventListener('pointerdown', (e) => {
    if (phase === 'done') {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('button')) return;
      if (target && target.closest('.board-list, .skin-grid, .ach-list')) return;
      resetAttempt();
    }
  });

  // ---- 移动端适配 ----
  const rotateOverlay = document.getElementById('rotate-overlay')!;
  const isPortraitPhone = (): boolean =>
    window.innerHeight > window.innerWidth && window.innerWidth < 700;

  window.addEventListener('blur', () => input.resetHeld());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) input.resetHeld();
  });

  const fsBtn = document.getElementById('btn-fs')!;
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  });

  function saveBestIfBetter(): BestRecord | null {
    const s = world.snapshot;
    if (s.score <= 0) return null;
    if (best && s.score <= best.score) return null;
    const rec: BestRecord = {
      score: s.score,
      timeMs: s.timeMs,
      coins: s.coinCount,
      distanceM: s.distanceM,
      finished: s.finished,
    };
    best = rec;
    saveBestRecord(dateStr, rec);
    return rec;
  }

  function commitAttempt(): void {
    saveBestIfBetter();
    const s = world.snapshot;
    if (s.score > 0) {
      saveDayRecord({
        date: dateStr,
        score: s.score,
        timeMs: s.timeMs,
        distanceM: s.distanceM,
        coins: s.coinCount,
        finished: s.finished,
        attempts,
        updatedAt: Date.now(),
      });
      streak = calculateStreak(dateStr);
    }
    hud.setMeta(attempts, best ? fmtBest(best) : '--', streak);
  }

  function showResultPanel(): void {
    const s = world.snapshot;
    hud.showResult({
      finished: s.finished,
      timeMs: s.timeMs,
      distanceM: s.distanceM,
      score: s.score,
      coins: s.coinCount,
      streak,
      onRetry: () => resetAttempt(),
      onCard: () => void makeShareCard(),
      onTalents: () => openTalents(),
    });
  }

  async function makeShareCard(): Promise<void> {
    hud.toast('战报图生成中…');
    try {
      const s = world.snapshot;
      const cv = renderShareCard(assets, {
        dateStr,
        finished: s.finished,
        timeMs: s.timeMs,
        distanceM: s.distanceM,
        score: s.score,
        coins: s.coinCount,
        attempts,
      });
      const how = await exportShareCard(cv, `dashline-${dateStr}.png`);
      hud.toast(how === 'clipboard' ? '📸 战报图已复制，直接粘贴分享' : '📸 已下载战报图（剪贴板不可用）');
    } catch (e) {
      console.error(e);
      hud.toast('战报图生成失败');
    }
  }

  function handleEvents(events: SimEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'jump':
          sfx.jump();
          break;
        case 'land': {
          view.landSquash();
          sfx.land();
          const s = world.snapshot;
          view.fx.dust(s.x, s.y + PLAYER_R * s.gravDir);
          break;
        }
        case 'dash': {
          sfx.dash();
          view.onDash(ev.x, ev.y);
          vibrate(25);
          break;
        }
        case 'slam': {
          sfx.slam();
          view.onSlam(ev.x, ev.y);
          vibrate([35, 20, 35]);
          break;
        }
        case 'coin': {
          sfx.coin(ev.combo);
          hud.showCombo(ev.combo);
          vibrate(10);
          const pt = view.getCoinPoint(ev.index);
          if (pt) view.fx.coin(pt.x, pt.y);
          view.onCoin(ev.index);
          break;
        }
        case 'bounce': {
          const s = world.snapshot;
          view.fx.bouncePuff(s.x, s.y + PLAYER_R);
          view.addShake(3);
          sfx.djump();
          break;
        }
        case 'crumble': {
          const c = view.getCrumbleCenter(ev.index);
          if (c) view.fx.debris(c.x, c.y);
          sfx.crumble();
          break;
        }
        case 'ring': {
          sfx.ring();
          const pt = view.getRingPoint(ev.index);
          if (pt) view.fx.coin(pt.x, pt.y);
          view.addShake(1.5);
          break;
        }
        case 'djump': {
          sfx.djump();
          const s = world.snapshot;
          view.fx.bouncePuff(s.x, s.y + PLAYER_R * s.gravDir);
          break;
        }
        case 'boost': {
          sfx.boost();
          view.addShake(2.5);
          break;
        }
        case 'portal': {
          sfx.portal();
          const s = world.snapshot;
          view.onPortal(s.x, s.y, ev.dir);
          const ach = achievements.unlock('gravity_master');
          if (ach) hud.toast(`🏆 解锁成就【${ach.title}】！`);
          break;
        }
        case 'shield': {
          sfx.shield();
          view.onShield(ev.index);
          hud.toast('🛡️ 获得水晶护盾！');
          break;
        }
        case 'shieldBreak': {
          sfx.shieldBreak();
          vibrate(45);
          const s = world.snapshot;
          view.onShieldBreak(s.x, s.y);
          usedShieldInRun = true;
          hud.toast('🛡️ 护盾抵扣了一次致命伤害！');
          break;
        }
        case 'magnet': {
          sfx.magnet();
          view.onMagnet(ev.index);
          hud.toast('🧲 磁力宝石激活！');
          break;
        }
        case 'nearmiss': {
          sfx.nearmiss();
          vibrate(15);
          view.onNearMiss(ev.x, ev.y);
          nearMissCountInRun++;
          if (nearMissCountInRun >= 2) {
            const ach = achievements.unlock('near_miss');
            if (ach) hud.toast(`🏆 解锁成就【${ach.title}】！`);
          }
          break;
        }
        case 'crash': {
          phase = 'dead';
          deadUntil = performance.now() + 450;
          view.addShake(11);
          hud.flash();
          sfx.crash();
          vibrate([60, 40, 80]);
          const s = world.snapshot;
          view.fx.crash(s.x, s.y);
          commitAttempt();
          break;
        }
        case 'finish': {
          phase = 'done';
          sfx.finish();
          view.fx.finish(world.track.finishX, GROUND_Y - 150);
          const s = world.snapshot;
          wardrobe.addCoins(s.coinCount);
          commitAttempt();

          const aFirst = achievements.unlock('first_finish');
          if (aFirst) hud.toast(`🏆 解锁成就【${aFirst.title}】！`);

          if (s.coinCount >= 15) {
            const aCoin = achievements.unlock('coin_master');
            if (aCoin) hud.toast(`🏆 解锁成就【${aCoin.title}】！`);
          }
          if (usedShieldInRun) {
            const aShield = achievements.unlock('shield_hero');
            if (aShield) hud.toast(`🏆 解锁成就【${aShield.title}】！`);
          }
          if (streak >= 7) {
            const aStreak = achievements.unlock('streak_7');
            if (aStreak) hud.toast(`🏆 解锁成就【${aStreak.title}】！`);
          }
          showResultPanel();
          break;
        }
      }
    }
  }

  function stepOnce(): void {
    const inp = input.poll();
    world.step(inp);
    handleEvents(world.takeEvents());
  }

  // ---- 固定步长主循环 ----
  let last = performance.now();
  let acc = 0;
  app.ticker.add(() => {
    const now = performance.now();
    const blocked = isPortraitPhone();
    rotateOverlay.classList.toggle('show', blocked);
    if (blocked || phase === 'pause') {
      last = now;
      acc = 0;
      return;
    }
    acc += Math.min((now - last) / 1000, 0.25);
    last = now;

    if (phase === 'run') {
      while (acc >= STEP_S) {
        stepOnce();
        acc -= STEP_S;
        if (phase !== 'run') break;
      }
    } else {
      acc = 0;
      if (phase === 'dead' && now >= deadUntil) {
        phase = 'done';
        showResultPanel();
      }
    }

    const snap = world.snapshot;
    view.sync(snap, now / 1000);
    hud.update(snap.timeMs, snap.distanceM, snap.coinCount);
  });

  resetAttempt();
  document.documentElement.dataset.dashlineReady = 'true';
}

void boot().catch((error: unknown) => {
  document.documentElement.dataset.dashlineReady = 'failed';
  console.error('Dashline 启动失败', error);
});
