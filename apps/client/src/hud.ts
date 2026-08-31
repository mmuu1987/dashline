/** HUD：全部 DOM 覆盖层，canvas 之外的一切 UI。 */
import type { SkinDef } from './wardrobe.js';
import type { AchievementDef } from './achievements.js';

export interface ResultData {
  finished: boolean;
  timeMs: number;
  score: number;
  coins: number;
  streak?: number;
  onRetry: () => void;
  onCard: () => void;
  onTalents?: () => void;
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

  private lastStatsText = '';
  update(timeMs: number, distanceM: number, coinCount: number): void {
    const text = `⏱ ${(timeMs / 1000).toFixed(2)}s\n📏 ${distanceM}m   🪙 ${coinCount}`;
    if (this.lastStatsText !== text) {
      this.lastStatsText = text;
      this.stats.textContent = text;
    }
  }

  setMeta(attempts: number, bestText: string, streak?: number): void {
    const streakBadge = streak && streak > 0 ? ` · 🔥 ${streak}连胜` : '';
    this.meta.textContent = `尝试 #${attempts}${streakBadge}\n今日最佳 ${bestText}`;
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
    const streakTag = d.streak && d.streak > 0 ? ` · 🔥 ${d.streak}天连胜` : '';
    this.panel.innerHTML = `
      <h2>${title}</h2>
      <div class="big">${(d.finished ? d.timeMs / 1000 : d.score).toLocaleString?.() ?? ''}${d.finished ? ' s' : ' 分'}</div>
      <div class="row">${time} · 🪙 ${d.coins}${streakTag}</div>
      <div class="btns">
        <button id="btn-retry">再跑一次</button>
        <button id="btn-talents-res" class="race-btn">⚡ 天赋强化</button>
        <button id="btn-card" class="secondary-btn">📸 战报</button>
      </div>`;
    document.getElementById('btn-retry')!.onclick = d.onRetry;
    if (d.onTalents && document.getElementById('btn-talents-res')) {
      document.getElementById('btn-talents-res')!.onclick = d.onTalents;
    }
    document.getElementById('btn-card')!.onclick = d.onCard;
    this.resultEl.onclick = (e) => {
      if (e.target === this.resultEl) d.onRetry();
    };
    this.resultEl.classList.add('show');
  }

  showWardrobe(
    skins: SkinDef[],
    totalCoins: number,
    currentId: string,
    onAction: (id: string) => void,
    onClose: () => void,
  ): void {
    this.resultEl.onclick = null;
    const cards = skins
      .map((s) => {
        const isEquipped = s.id === currentId;
        const btnText = isEquipped ? '已装备' : s.unlocked ? '装备' : `🪙 ${s.price} 解锁`;
        const btnClass = isEquipped ? 'secondary-btn' : s.unlocked ? '' : 'race-btn';
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
    this.resultEl.onclick = null;
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

  showTalents(
    talents: import('./talents.js').TalentDef[],
    totalCoins: number,
    onUpgrade: (id: string) => void,
    onClose: () => void,
  ): void {
    this.resultEl.onclick = null;
    const cards = talents
      .map((t) => {
        const isMax = t.level >= t.maxLevel;
        const curCost = isMax ? null : t.costs[t.level];
        const canAfford = curCost !== null && totalCoins >= curCost;
        const btnText = isMax ? '已满级' : `🪙 ${curCost} 升级`;
        const btnClass = isMax ? 'secondary-btn' : canAfford ? 'race-btn' : 'secondary-btn';
        const levelStars = '★'.repeat(t.level) + '☆'.repeat(t.maxLevel - t.level);
        const curEffect = t.level > 0 ? t.effects[t.level - 1] : '未激活';
        const nextEffect = !isMax ? `<div style="color:#38bdf8;font-size:11px;margin-top:2px;">下级: ${t.effects[t.level]}</div>` : '';

        return `
          <div class="skin-card">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:22px;">${t.icon}</span>
              <div>
                <div class="s-name" style="margin:0;">${t.name} <span style="color:#f59e0b;font-size:12px;margin-left:4px;">${levelStars}</span></div>
                <div style="color:#94a3b8;font-size:11px;">当前: ${curEffect}</div>
              </div>
            </div>
            <div class="s-desc" style="margin-top:4px;">${t.desc}</div>
            ${nextEffect}
            <button class="s-btn ${btnClass}" data-id="${t.id}" style="margin-top:8px;" ${isMax || !canAfford ? 'disabled' : ''}>${btnText}</button>
          </div>`;
      })
      .join('');

    this.panel.innerHTML = `
      <h2>⚡ 单机天赋强化</h2>
      <div class="row" style="color: #ffd23f;">当前资产：🪙 <b>${totalCoins}</b> 宝石</div>
      <div class="skin-grid">${cards}</div>
      <div class="btns"><button id="btn-tclose">关闭</button></div>`;

    for (const b of Array.from(this.panel.querySelectorAll<HTMLButtonElement>('.s-btn:not([disabled])'))) {
      b.onclick = () => onUpgrade(b.dataset.id!);
    }
    document.getElementById('btn-tclose')!.onclick = onClose;
    this.resultEl.classList.add('show');
  }

  hideResult(): void {
    this.resultEl.classList.remove('show');
  }

  isModalOpen(): boolean {
    return this.resultEl.classList.contains('show');
  }
}
