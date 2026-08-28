/**
 * 客户端主循环 —— 固定步长逻辑 + 渲染（60Hz rAF）。
 * 职责：装配 core/输入/渲染/HUD/音频/网络/衣橱/成就，维护"尝试"状态机与 Ghost 对手选择。
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
import {
  CORE_VERSION,
  decodeInputs,
  encodeInputs,
  seedForDate,
  themeForSeed,
  todayUTC,
  type RunPayload,
} from '@dashline/shared';
import { Sfx } from './audio.js';
import { Hud } from './hud.js';
import { InputBuffer } from './input.js';
import { calculateStreak, saveDayRecord } from './meta.js';
import {
  fetchBoard,
  fetchGhosts,
  lsGet,
  lsSet,
  probeApi,
  registerDevice,
  submitRun,
  type AuthInfo,
  type BoardEntry,
  type GhostOffer,
} from './net.js';
import { GameView, VIEW_H, VIEW_W } from './render.js';
import { THEMES } from './render/background.js';
import { loadAssets } from './render/textures.js';
import { exportShareCard, renderShareCard } from './share-card.js';
import { Wardrobe } from './wardrobe.js';
import { Achievements } from './achievements.js';
import { Talents } from './talents.js';

const STEP_S = 1 / 60;

const vibrate = (p: number | number[]): void => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(p);
    } catch {
      // ignore
    }
  }
};

interface BestRecord {
  score: number;
  timeMs: number;
  coins: number;
  distanceM: number;
  finished: boolean;
  inputsB64: string;
}

interface FriendChallenge {
  inputsB64: string;
  name: string;
  timeMs: number | null;
}

interface Racer {
  label: string;
  bytes: Uint8Array | null;
  timeMs: number | null;
}

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
  const ghostKey = `dl_best_${dateStr}`;
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
  input.onPause(() => togglePause());

  function enterModal(): void {
    if (phase === 'run') {
      phase = 'pause';
    }
  }

  function exitModal(): void {
    const s = world.snapshot;
    if (!s.alive || s.finished || phase === 'done' || phase === 'dead') {
      phase = 'done';
      showResultPanel();
      return;
    }
    hud.hideResult();
    phase = 'run';
    last = performance.now();
    acc = 0;
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
  let attempts = 0;
  let deadUntil = 0;
  let world: World = createWorld(seed, talents.getPerksConfig());
  let recorder: number[] = [];
  let best: BestRecord | null = null;
  let usedShieldInRun = false;
  let nearMissCountInRun = 0;

  try {
    const raw = lsGet(ghostKey);
    if (raw) best = JSON.parse(raw) as BestRecord;
  } catch {
    best = null;
  }

  // ---- 好友复仇 URL 参数解析 ----
  function parseFriendChallenge(): FriendChallenge | null {
    try {
      const hash = location.hash.slice(1);
      if (!hash) return null;
      const params = new URLSearchParams(hash);
      const g = params.get('g');
      if (!g) return null;
      const name = params.get('n') || '好友';
      const t = params.get('t');
      return {
        inputsB64: g,
        name: decodeURIComponent(name),
        timeMs: t ? parseInt(t, 10) : null,
      };
    } catch {
      return null;
    }
  }
  const friendChallenge = parseFriendChallenge();
  if (friendChallenge) {
    hud.toast(`⚔ 接受来自【${friendChallenge.name}】的复仇挑战！`);
  }

  // ---- 网络：探测 API 与注册设备 ----
  let auth: AuthInfo | null = null;
  let apiOnline = false;
  let ghostOffers: GhostOffer[] = [];
  let forcedOffer: GhostOffer | null = null;

  void (async () => {
    apiOnline = await probeApi();
    hud.setMode(apiOnline ? '在线模式 · 榜单已连接' : '单机模式');
    if (apiOnline) {
      auth = await registerDevice();
      const offers = await fetchGhosts(dateStr);
      if (offers) ghostOffers = offers;
    }
  })();

  // ---- Ghost 对手分配 ----
  let racer: Racer = { label: '', bytes: null, timeMs: null };
  let racerWorld: World = createWorld(seed);
  let racerIdx = 0;
  let racerDone = true;
  let startLabel = '';
  let startTimeMs: number | null = null;
  let lastDelta: string | null = null;

  function fmtBest(b: BestRecord): string {
    return b.finished ? `${(b.timeMs / 1000).toFixed(2)}s` : `${b.distanceM}m`;
  }

  function armRacer(): void {
    if (friendChallenge) {
      try {
        racer = {
          label: `⚔ ${friendChallenge.name}`,
          bytes: decodeInputs(friendChallenge.inputsB64),
          timeMs: friendChallenge.timeMs,
        };
      } catch {
        racer = { label: '', bytes: null, timeMs: null };
      }
    } else if (forcedOffer) {
      try {
        racer = {
          label: `⚔ ${forcedOffer.nickname}`,
          bytes: decodeInputs(forcedOffer.inputsB64),
          timeMs: forcedOffer.timeMs,
        };
      } catch {
        racer = { label: '', bytes: null, timeMs: null };
      }
    } else if (ghostOffers.length > 0 && ghostOffers[0]) {
      const top = ghostOffers[0];
      try {
        racer = {
          label: `👑 榜首 ${top.nickname}`,
          bytes: decodeInputs(top.inputsB64),
          timeMs: top.timeMs,
        };
      } catch {
        racer = { label: '', bytes: null, timeMs: null };
      }
    } else if (best) {
      try {
        racer = { label: '🎯 你的最佳', bytes: decodeInputs(best.inputsB64), timeMs: best.timeMs };
      } catch {
        racer = { label: '', bytes: null, timeMs: null };
      }
    } else {
      racer = { label: '', bytes: null, timeMs: null };
    }

    if (racer.bytes) {
      racerWorld = createWorld(seed);
      racerIdx = 0;
      racerDone = false;
    } else {
      racerDone = true;
    }
    startLabel = racer.label;
    startTimeMs = racer.timeMs;
  }

  function resetAttempt(): void {
    world = createWorld(seed, talents.getPerksConfig());
    view.setTrack(world.track);
    view.resetCamera();
    view.resetAttemptFx(START_X, START_Y);
    recorder = [];
    attempts++;
    usedShieldInRun = false;
    nearMissCountInRun = 0;
    armRacer();
    phase = 'run';
    hud.hideResult();
    hud.showPause(false);
    pauseBtn.textContent = '⏸';
    hud.setMeta(attempts, best ? fmtBest(best) : '--', racer.label || undefined, streak);
  }

  input.onRestart(() => {
    if (phase !== 'dead') resetAttempt();
  });

  input.onAction(() => {
    if (phase === 'done') {
      resetAttempt();
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
      inputsB64: encodeInputs(Uint8Array.from(recorder)),
    };
    best = rec;
    lsSet(ghostKey, JSON.stringify(rec));
    return rec;
  }

  async function pushToApi(rec: BestRecord): Promise<void> {
    if (!apiOnline || !auth || !rec.finished) return;
    const payload: RunPayload = {
      scope: 'daily',
      date: dateStr,
      score: rec.score,
      finished: rec.finished,
      timeMs: rec.timeMs,
      distanceM: rec.distanceM,
      coins: rec.coins,
      attemptNo: attempts,
      clientVersion: CORE_VERSION,
      inputsB64: rec.inputsB64,
    };
    const ack = await submitRun(payload, auth);
    if (ack.exhausted) {
      hud.toast('今日计分次数已用完 · 继续练习模式');
    } else if (ack.rank) {
      hud.toast(`已上榜：第 ${ack.rank} / ${ack.total ?? '?'} 名${ack.attemptsLeft !== undefined ? ` · 剩 ${ack.attemptsLeft} 次` : ''}`);
    }
  }

  function commitAttempt(): void {
    const rec = saveBestIfBetter();
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
    hud.setMeta(attempts, best ? fmtBest(best) : '--', racer.label || undefined, streak);
    if (rec) void pushToApi(rec);
  }

  function challengeUrl(): string {
    const s = world.snapshot;
    const b64 = encodeInputs(Uint8Array.from(recorder));
    const name = encodeURIComponent(auth?.nickname ?? '神秘跑者');
    const t = s.finished ? `&t=${s.timeMs}` : '';
    return `${location.origin}${location.pathname}#g=${b64}&n=${name}${t}`;
  }

  function shareResult(): void {
    const s = world.snapshot;
    const text =
      `🏁 Dashline ${dateStr}\n` +
      (s.finished
        ? `⏱ ${(s.timeMs / 1000).toFixed(2)}s  🪙 ${s.coinCount}`
        : `📏 ${s.distanceM}m  🪙 ${s.coinCount}`) +
      `\n敢来超我吗？👇\n${challengeUrl()}`;
    void navigator.clipboard
      ?.writeText(text)
      .then(() => hud.toast('战绩+挑战链接已复制，甩到群里吧'))
      .catch(() => hud.toast('复制失败（浏览器限制）'));
  }

  async function openBoard(): Promise<void> {
    enterModal();
    hud.toast('榜单加载中…');
    const [entries, offers] = await Promise.all([fetchBoard(dateStr), fetchGhosts(dateStr)]);
    if (offers) ghostOffers = offers;
    const rows = (entries ?? []).map((e: BoardEntry) => ({
      rank: e.rank,
      nickname: e.nickname,
      timeMs: e.timeMs,
      score: e.score,
      raceable: (offers ?? []).some(
        (o) => o.nickname === e.nickname && o.timeMs === e.timeMs,
      ),
    }));
    const myLine = best ? `我的最佳：${fmtBest(best)}` : null;
    hud.showBoard(
      rows,
      myLine,
      (i) => {
        const offer = ghostOffers[i];
        if (!offer) return;
        forcedOffer = offer;
        exitModal();
        hud.toast(`将挑战 ${offer.nickname}（${(offer.timeMs / 1000).toFixed(2)}s）`);
        resetAttempt();
      },
      exitModal,
    );
  }

  function showResultPanel(): void {
    const s = world.snapshot;
    let delta: string | null = null;
    if (startTimeMs !== null && s.finished) {
      const d = s.timeMs - startTimeMs;
      const who = startLabel.replace(/^[⚔👑🎯]\s*/, '');
      delta =
        d < 0
          ? `🟢 快过 ${who} ${((-d) / 1000).toFixed(2)}s！`
          : `🔴 慢于 ${who} ${(d / 1000).toFixed(2)}s`;
    }
    lastDelta = delta;
    hud.showResult({
      finished: s.finished,
      timeMs: s.timeMs,
      score: s.score,
      coins: s.coinCount,
      streak,
      ghostDelta: delta,
      onRetry: () => resetAttempt(),
      onCard: () => void makeShareCard(),
      onShare: shareResult,
      onBoard: () => void openBoard(),
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
        beatText: lastDelta,
        url: `${location.origin}${location.pathname}`,
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
          view.onShield(0);
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
          view.onMagnet(0);
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

          commitAttempt();
          showResultPanel();
          break;
        }
      }
    }
  }

  function stepOnce(): void {
    const inp = input.poll();
    world.step(inp);
    recorder.push(inp);
    handleEvents(world.takeEvents());
    if (!racerDone && racer.bytes) {
      if (racerIdx < racer.bytes.length) {
        racerWorld.step(racer.bytes[racerIdx++]!);
        const gs = racerWorld.snapshot;
        if (!gs.alive || gs.finished) racerDone = true;
      } else {
        racerDone = true;
      }
    }
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
    const ghostSnap = racerDone || !racer.bytes ? null : racerWorld.snapshot;
    view.sync(snap, ghostSnap, now / 1000);
    hud.update(snap.timeMs, snap.distanceM, snap.coinCount);
  });

  resetAttempt();
}

void boot();
