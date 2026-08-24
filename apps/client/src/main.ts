/**
 * 客户端主循环 —— 固定步长逻辑 + 渲染（60Hz rAF）。
 * 职责：装配 core/输入/渲染/HUD/音频/网络，维护"尝试"状态机与 Ghost 对手选择。
 *
 * 对手优先级（每次尝试重新裁定）：
 *   1. 好友复仇链接（URL #g=…）  2. 榜单点名的挑战目标
 *   3. 远程榜首（API 下发输入流） 4. 本地今日最佳之你
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
  todayUTC,
  type RunPayload,
} from '@dashline/shared';
import { Sfx } from './audio.js';
import { Hud } from './hud.js';
import { InputBuffer } from './input.js';
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
import { loadAssets } from './render/textures.js';
import { exportShareCard, renderShareCard } from './share-card.js';

const STEP_S = 1 / 60;

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

/** 当前 Ghost 对手 */
interface Racer {
  label: string;
  bytes: Uint8Array | null;
  /** 对手完赛用时（null=未完赛，无法判胜负） */
  timeMs: number | null;
}

type Phase = 'run' | 'dead' | 'done';

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    width: VIEW_W,
    height: VIEW_H,
    background: '#12141c',
    antialias: true,
    // 手机高分屏清晰渲染（上限 2x 控制填充率开销）
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: false,
  });
  app.canvas.classList.add('game-canvas');
  document.getElementById('game')!.appendChild(app.canvas);

  const hud = new Hud();
  const sfx = new Sfx();
  const assets = await loadAssets();
  const view = new GameView(assets);
  app.stage.addChild(view.root);
  const input = new InputBuffer();
  input.attach(app.canvas);
  window.addEventListener('pointerdown', () => sfx.unlock());
  window.addEventListener('keydown', () => sfx.unlock());

  // ---- 静音按钮（状态持久化在 Sfx 内）----
  const muteBtn = document.getElementById('btn-mute')!;
  muteBtn.textContent = sfx.isMuted() ? '🔇' : '🔊';
  muteBtn.addEventListener('click', () => {
    const muted = sfx.toggleMute();
    muteBtn.textContent = muted ? '🔇' : '🔊';
    if (!muted) sfx.unlock(); // 解除静音时顺带恢复 BGM
  });

  // ---- 每日种子 ----
  const dateStr = todayUTC();
  const seed = seedForDate(dateStr);
  const ghostKey = `dl_best_${dateStr}`;

  // ---- 状态 ----
  let phase: Phase = 'run';
  let attempts = 0;
  let deadUntil = 0;
  let world: World = createWorld(seed);
  let recorder: number[] = [];
  let best: BestRecord | null = null;
  try {
    const raw = lsGet(ghostKey);
    if (raw) best = JSON.parse(raw) as BestRecord;
  } catch {
    best = null;
  }

  let apiOnline = false;
  let auth: AuthInfo | null = null;
  let remoteTop: GhostOffer | null = null;
  let ghostOffers: GhostOffer[] = [];

  void probeApi().then(async (ok) => {
    apiOnline = ok;
    hud.setMode(ok ? '在线模式 · 榜单已连接' : '本地模式 · 挑战今日最佳之你');
    if (!ok) return;
    auth = await registerDevice();
    const offers = await fetchGhosts(dateStr);
    if (offers && offers.length > 0) {
      ghostOffers = offers;
      remoteTop = offers[0]!;
      hud.toast(`👑 榜首 ${remoteTop.nickname} 的 Ghost 已就位`);
    }
  });

  const fmtBest = (b: BestRecord): string =>
    b.finished ? `${(b.timeMs / 1000).toFixed(2)}s` : `${b.distanceM}m`;

  // ---- 好友复仇链接（URL hash 即挑战状态，离线也可用）----
  function readFriendChallenge(): FriendChallenge | null {
    const raw = location.hash.startsWith('#') ? location.hash.slice(1) : '';
    if (!raw.includes('g=')) return null;
    const p = new URLSearchParams(raw);
    const g = p.get('g');
    if (!g || g.length > 4096) return null;
    try {
      decodeInputs(g); // 校验合法性
      const t = p.get('t');
      return {
        inputsB64: g,
        name: p.get('n') ?? '好友',
        timeMs: t ? Number(t) : null,
      };
    } catch {
      return null;
    }
  }
  const friend = readFriendChallenge();

  // ---- Racer（当前对手）----
  let racer: Racer = { label: '', bytes: null, timeMs: null };
  let racerWorld: World = createWorld(seed);
  let racerIdx = 0;
  let racerDone = true;
  let forcedOffer: GhostOffer | null = null;
  let startLabel = '';
  let startTimeMs: number | null = null;
  let lastDelta: string | null = null;

  function armRacer(): void {
    const f = friend ?? null;
    if (f) {
      try {
        racer = { label: `⚔ ${f.name}`, bytes: decodeInputs(f.inputsB64), timeMs: f.timeMs };
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
    } else if (remoteTop && (!best || best.inputsB64 !== remoteTop.inputsB64)) {
      try {
        racer = {
          label: `👑 ${remoteTop.nickname}`,
          bytes: decodeInputs(remoteTop.inputsB64),
          timeMs: remoteTop.timeMs,
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
    world = createWorld(seed);
    view.setTrack(world.track);
    view.resetCamera();
    view.resetAttemptFx(START_X, START_Y);
    recorder = [];
    attempts++;
    armRacer();
    phase = 'run';
    hud.hideResult();
    hud.setMeta(attempts, best ? fmtBest(best) : '--', racer.label || undefined);
  }

  input.onRestart(() => {
    if (phase !== 'dead') resetAttempt();
  });

  // ---- 移动端适配 ----
  const rotateOverlay = document.getElementById('rotate-overlay')!;
  /** 竖屏且屏幕偏小 → 视为手机竖屏，冻结模拟并提示旋转 */
  const isPortraitPhone = (): boolean =>
    window.innerHeight > window.innerWidth && window.innerWidth < 700;

  // 切后台/失焦清空输入，防止回来时"按住跳跃"卡死
  window.addEventListener('blur', () => input.resetHeld());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) input.resetHeld();
  });

  // 全屏按钮（仅触屏设备显示）
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
    if (!apiOnline || !auth || !rec.finished) return; // 只上报完赛成绩
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
    hud.setMeta(attempts, best ? fmtBest(best) : '--', racer.label || undefined);
    if (rec) void pushToApi(rec);
  }

  /** 用本次尝试的输入流构造复仇链接 */
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
        hud.hideBoard();
        hud.toast(`将挑战 ${offer.nickname}（${(offer.timeMs / 1000).toFixed(2)}s）`);
        resetAttempt();
      },
      () => hud.hideBoard(),
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
      ghostDelta: delta,
      onRetry: () => resetAttempt(),
      onCard: () => void makeShareCard(),
      onShare: shareResult,
      onBoard: () => void openBoard(),
    });
  }

  /** 生成战报卡并复制/下载 */
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
          view.fx.dust(s.x, s.y + PLAYER_R);
          break;
        }
        case 'coin': {
          sfx.coin();
          const pt = view.getCoinPoint(ev.index);
          if (pt) view.fx.coin(pt.x, pt.y);
          break;
        }
        case 'bounce': {
          const s = world.snapshot;
          view.fx.bouncePuff(s.x, s.y + PLAYER_R);
          view.addShake(3);
          sfx.djump(); // 与二段跳共用"弹簧音"
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
          if (pt) view.fx.coin(pt.x, pt.y); // 金色爆发复用
          view.addShake(1.5);
          break;
        }
        case 'djump': {
          sfx.djump();
          {
            const s = world.snapshot;
            view.fx.bouncePuff(s.x, s.y + PLAYER_R);
          }
          break;
        }
        case 'boost': {
          sfx.boost();
          view.addShake(2.5);
          break;
        }
        case 'crash': {
          phase = 'dead';
          deadUntil = performance.now() + 450;
          view.addShake(11);
          hud.flash();
          sfx.crash();
          {
            const s = world.snapshot;
            view.fx.crash(s.x, s.y);
          }
          commitAttempt();
          break;
        }
        case 'finish':
          phase = 'done';
          sfx.finish();
          view.fx.finish(world.track.finishX, GROUND_Y - 150);
          commitAttempt();
          showResultPanel();
          break;
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
    // 手机竖屏：冻结模拟，展示旋转提示（不累积时间，转回来无伤恢复）
    const blocked = isPortraitPhone();
    rotateOverlay.classList.toggle('show', blocked);
    if (blocked) {
      last = now;
      acc = 0;
      return;
    }
    acc += Math.min((now - last) / 1000, 0.25);
    last = now;
    while (acc >= STEP_S) {
      acc -= STEP_S;
      if (phase === 'run') {
        stepOnce();
      } else {
        input.poll(); // 非 run 阶段吞掉输入防堆积
        if (phase === 'dead' && now >= deadUntil) resetAttempt();
      }
    }
    const snap = world.snapshot;
    hud.update(snap.timeMs, snap.distanceM, snap.coinCount);
    view.sync(snap, racerDone ? null : racerWorld.snapshot, now / 1000);
  });

  resetAttempt();
  if (friend) {
    setTimeout(() => hud.toast(`⚔ 收到 ${friend.name} 的挑战！跑赢 TA 的残影`), 600);
  }
}

boot().catch((e: unknown) => {
  console.error(e);
  const el = document.getElementById('game');
  if (el) {
    el.textContent = `加载失败：${(e as Error)?.message ?? e}`;
    (el as HTMLElement).style.cssText =
      'color:#ff8fa3;font:14px/1.6 sans-serif;padding:24px;white-space:pre-wrap;';
  }
});
