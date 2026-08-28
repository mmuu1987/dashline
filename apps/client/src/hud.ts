/** HUD：全部 DOM 覆盖层，canvas 之外的一切 UI。 */
import type { SkinDef } from './wardrobe.js';
import type { AchievementDef } from './achievements.js';

export interface ResultData {
  finished: boolean;
  timeMs: number;
  score: number;
  coins: number;
  streak?: number;
  ghostDelta: string | null;
  onRetry: () => void;
  onCard: () => void;
  onShare: () => void;
  onBoard: () => void;
}

export interface BoardRow {
  rank: number;
  nickname: string;
  timeMs: number | null;
  score: number;
  raceable: boolean;
}

export class Hud {
  private stats = document.getElementById('hud-stats')!;
  private meta = document.getElementById('hud-meta')!;
  private mode = document.getElementById('hud-mode')!;
  private flashEl = document.getElementById('flash')!;
  private resultEl = document.getElementById('result')!;
  private panel = document.getElementById('result-panel')!;
  private pauseBadge = document.getElementById('pause-badge')!;
  private comboTag = document.getElementById('combo-tag')!;
  private toastEl = document.getElementById('toast')!;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private comboTimer: ReturnType<typeof setTimeout> | null = null;

  showPause(show: boolean): void {
    this.pauseBadge.classList.toggle('show', show);
  }

  showCombo(combo: number): void {
    if (combo <= 1) return;
    this.comboTag.textContent = combo >= 5 ? `🔥 Combo x${combo} MAX!` : `✨ Combo x${combo}!`;
    this.comboTag.classList.remove('pop');
    void this.comboTag.offsetWidth; // 触发重绘
    this.comboTag.classList.add('pop');
    if (this.comboTimer) clearTimeout(this.comboTimer);
    this.comboTimer = setTimeout(() => this.comboTag.classList.remove('pop'), 800);
  }

  update(timeMs: number, distanceM: number, coinCount: number): void {
    this.stats.textContent =
      `⏱ ${(timeMs / 1000).toFixed(2)}s\n` +
      `📏 ${distanceM}m   🪙 ${coinCount}`;
  }

  setMeta(attempts: number, bestText: string, opponent?: string, streak?: number): void {
    const streakBadge = streak && streak > 0 ? ` · 🔥 ${streak}连胜` : '';
    this.meta.textContent =
      `尝试 #${attempts}${streakBadge}\n今日最佳 ${bestText}` + (opponent ? `\n${opponent}` : '');
  }

  setMode(text: string): void {
    this.mode.textContent = text;
  }

  flash(): void {
    this.flashEl.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => this.flashEl.classList.remove('on')));
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 1800);
  }

  showResult(d: ResultData): void {
    const title = d.finished ? '🏁 完赛！' : '💥 撞毁了…';
    const time = d.finished ? `⏱ 用时 <b>${(d.timeMs / 1000).toFixed(2)}s</b>` : `📏 距离 <b>${Math.floor(d.score / 100)}m</b>`;
    const ghost = d.ghostDelta ? `<div class="row">${d.ghostDelta}</div>` : '';
    const streakTag = d.streak && d.streak > 0 ? ` · 🔥 ${d.streak}天连胜` : '';
    this.panel.innerHTML = `
      <h2>${title}</h2>
      <div class="big">${(d.finished ? d.timeMs / 1000 : d.score).toLocaleString?.() ?? ''}${d.finished ? ' s' : ' 分'}</div>
      <div class="row">${time} · 🪙 ${d.coins}${streakTag}</div>
      ${ghost}
      <div class="btns">
        <button id="btn-retry">再跑一次</button>
        <button id="btn-card" class="ghost-btn">📸 战报图</button>
        <button id="btn-share" class="ghost-btn">复制战绩</button>
        <button id="btn-board" class="ghost-btn">榜单</button>
      </div>`;
    document.getElementById('btn-retry')!.onclick = d.onRetry;
    document.getElementById('btn-card')!.onclick = d.onCard;
    document.getElementById('btn-share')!.onclick = d.onShare;
    document.getElementById('btn-board')!.onclick = d.onBoard;
    this.resultEl.classList.add('show');
  }

  showBoard(
    rows: BoardRow[],
    myLine: string | null,
    onRace: (index: number) => void,
    onClose: () => void,
  ): void {
    const list = rows.length
      ? rows
          .map((r, i) => {
            const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `${r.rank}`;
            const t = r.timeMs !== null ? `${(r.timeMs / 1000).toFixed(2)}s` : `${Math.floor(r.score / 100)}m`;
            const btn = r.raceable
              ? `<button class="race-btn" data-i="${i}">⚔ 挑战</button>`
              : '';
            return `<div class="brow"><span class="bk">${medal}</span><span class="bn">${r.nickname}</span><span class="bt">${t}</span>${btn}</div>`;
          })
          .join('')
      : '<div class="row" style="opacity:.6">今日还没有人上榜，来当第一人！</div>';
    this.panel.innerHTML = `
      <h2>🏆 今日榜单</h2>
      <div class="board-list">${list}</div>
      ${myLine ? `<div class="row my-line">${myLine}</div>` : ''}
      <div class="btns"><button id="btn-bclose">关闭</button></div>`;
    for (const b of Array.from(this.panel.querySelectorAll<HTMLButtonElement>('.race-btn'))) {
      b.onclick = () => onRace(Number(b.dataset.i));
    }
    document.getElementById('btn-bclose')!.onclick = onClose;
    this.resultEl.classList.add('show');
  }

  showWardrobe(
    skins: SkinDef[],
    totalCoins: number,
    currentId: string,
    onAction: (id: string) => void,
    onClose: () => void,
  ): void {
    const cards = skins
      .map((s) => {
        const isEquipped = s.id === currentId;
        const btnText = isEquipped ? '已装备' : s.unlocked ? '装备' : `🪙 ${s.price} 解锁`;
        const btnClass = isEquipped ? 'ghost-btn' : s.unlocked ? '' : 'race-btn';
        return `
          <div class="skin-card ${isEquipped ? 'active' : ''}">
            <div class="s-name">${s.name}</div>
            <div class="s-desc">${s.desc}</div>
            <button class="s-btn ${btnClass}" data-id="${s.id}">${btnText}</button>
          </div>`;
      })
      .join('');

    this.panel.innerHTML = `
      <h2>👗 外观衣橱</h2>
      <div class="row" style="color: #ffd23f;">当前资产：🪙 <b>${totalCoins}</b> 宝石</div>
      <div class="skin-grid">${cards}</div>
      <div class="btns"><button id="btn-wclose">关闭</button></div>`;

    for (const b of Array.from(this.panel.querySelectorAll<HTMLButtonElement>('.s-btn'))) {
      b.onclick = () => onAction(b.dataset.id!);
    }
    document.getElementById('btn-wclose')!.onclick = onClose;
    this.resultEl.classList.add('show');
  }

  showAchievements(list: AchievementDef[], onClose: () => void): void {
    const items = list
      .map((a) => {
        const status = a.unlocked
          ? `<span style="color:#4ade80;font-size:12px;font-weight:700;">✓ 已达成</span>`
          : `<span style="color:#94a3b8;font-size:12px;">未解锁</span>`;
        return `
          <div class="ach-item ${a.unlocked ? '' : 'locked'}">
            <div class="a-icon">${a.icon}</div>
            <div class="a-info">
              <div class="a-title">${a.title}</div>
              <div class="a-desc">${a.desc}</div>
            </div>
            <div>${status}</div>
          </div>`;
      })
      .join('');

    this.panel.innerHTML = `
      <h2>🏆 荣誉成就</h2>
      <div class="ach-list">${items}</div>
      <div class="btns"><button id="btn-aclose">关闭</button></div>`;

    document.getElementById('btn-aclose')!.onclick = onClose;
    this.resultEl.classList.add('show');
  }

  hideBoard(): void {
    this.hideResult();
  }

  hideResult(): void {
    this.resultEl.classList.remove('show');
  }

  isModalOpen(): boolean {
    return this.resultEl.classList.contains('show');
  }
}
