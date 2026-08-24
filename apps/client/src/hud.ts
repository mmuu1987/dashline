/** HUD：全部 DOM 覆盖层，canvas 之外的一切 UI。 */

export interface ResultData {
  finished: boolean;
  timeMs: number;
  score: number;
  coins: number;
  ghostDelta: string | null;
  onRetry: () => void;
  onShare: () => void;
  onBoard: () => void;
}

export interface BoardRow {
  rank: number;
  nickname: string;
  timeMs: number | null;
  score: number;
  /** 是否拿到了该玩家的输入流（可发起 Ghost 挑战） */
  raceable: boolean;
}

export class Hud {
  private stats = document.getElementById('hud-stats')!;
  private meta = document.getElementById('hud-meta')!;
  private mode = document.getElementById('hud-mode')!;
  private flashEl = document.getElementById('flash')!;
  private resultEl = document.getElementById('result')!;
  private panel = document.getElementById('result-panel')!;
  private toastEl = document.getElementById('toast')!;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  update(timeMs: number, distanceM: number, coinCount: number): void {
    this.stats.textContent =
      `⏱ ${(timeMs / 1000).toFixed(2)}s\n` +
      `📏 ${distanceM}m   🪙 ${coinCount}`;
  }

  setMeta(attempts: number, bestText: string, opponent?: string): void {
    this.meta.textContent =
      `尝试 #${attempts}\n今日最佳 ${bestText}` + (opponent ? `\n${opponent}` : '');
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
    this.panel.innerHTML = `
      <h2>${title}</h2>
      <div class="big">${(d.finished ? d.timeMs / 1000 : d.score).toLocaleString?.() ?? ''}${d.finished ? ' s' : ' 分'}</div>
      <div class="row">${time} · 🪙 ${d.coins}</div>
      ${ghost}
      <div class="btns">
        <button id="btn-retry">再跑一次</button>
        <button id="btn-share" class="ghost-btn">复制战绩</button>
        <button id="btn-board" class="ghost-btn">榜单</button>
      </div>`;
    document.getElementById('btn-retry')!.onclick = d.onRetry;
    document.getElementById('btn-share')!.onclick = d.onShare;
    document.getElementById('btn-board')!.onclick = d.onBoard;
    this.resultEl.classList.add('show');
  }

  /** 今日榜单面板；raceable 的行可发起 Ghost 挑战 */
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

  hideBoard(): void {
    this.hideResult();
  }

  hideResult(): void {
    this.resultEl.classList.remove('show');
  }
}
