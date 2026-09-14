/** DOM presentation only; purchases, results and persistence remain in their existing owners. */
import type { SkinDef } from './wardrobe.js';
import type { AchievementDef } from './achievements.js';
import { art, escapeHtml, icon, localAsset } from './ui-icons.js';
import { skinColor } from './render/textures.js';

export interface ResultData {
  finished: boolean;
  timeMs: number;
  distanceM: number;
  score: number;
  coins: number;
  streak?: number;
  onRetry: () => void;
  onCard: () => void;
  onTalents?: () => void;
  onRewardedRevive?: () => void;
  onFreeRevive?: () => void;
  freeRevivesLeft?: number;
  freeRevivesUnlimited?: boolean;
  rewardBusy?: boolean;
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
  private timeValue: HTMLElement;
  private distanceValue: HTMLElement;
  private coinValue: HTMLElement;

  constructor() {
    this.stats.innerHTML = `<div class="stat-card">${icon('timer')}<span class="metric"><small>用时</small><strong data-metric="time">0.00s</strong></span></div><div class="stat-card">${icon('ruler')}<span class="metric"><small>距离</small><strong data-metric="distance">0m</strong></span></div><div class="stat-card gems">${art('gem_yellow')}<span class="metric"><small>宝石</small><strong data-metric="coins">0</strong></span></div>`;
    this.timeValue = this.stats.querySelector('[data-metric="time"]')!;
    this.distanceValue = this.stats.querySelector('[data-metric="distance"]')!;
    this.coinValue = this.stats.querySelector('[data-metric="coins"]')!;
  }
  showPause(show: boolean): void { this.pauseBadge.classList.toggle('show', show); }
  showCombo(combo: number): void {
    if (combo <= 1) return;
    this.comboTag.textContent = `COMBO ×${combo}${combo >= 5 ? ' / MAX' : ''}`;
    this.comboTag.classList.add('pop');
    if (this.comboTimer) clearTimeout(this.comboTimer);
    this.comboTimer = setTimeout(() => this.comboTag.classList.remove('pop'), 800);
  }
  update(timeMs: number, distanceM: number, coinCount: number): void {
    const write = (el: HTMLElement, text: string): void => { if (el.textContent !== text) el.textContent = text; };
    write(this.timeValue, `${(timeMs / 1000).toFixed(2)}s`);
    write(this.distanceValue, `${distanceM}m`);
    write(this.coinValue, String(coinCount));
  }
  setMeta(attempts: number, bestText: string, streak?: number): void {
    const streakText = streak && streak > 0 ? ` · 连续完赛 ${streak}天` : '';
    this.meta.innerHTML = `<span>尝试 #${attempts}${streakText}</span><strong>今日最佳 ${escapeHtml(bestText)}</strong>`;
  }
  setMode(text: string): void { this.mode.textContent = text; }
  flash(): void {
    this.flashEl.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => this.flashEl.classList.remove('on')));
  }
  toast(msg: string): void {
    this.toastEl.textContent = msg.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim();
    this.toastEl.classList.add('show');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 1800);
  }
  showResult(d: ResultData): void {
    const freeCount = d.freeRevivesUnlimited ? '无限' : `剩 ${d.freeRevivesLeft ?? 0}`;
    const busy = d.rewardBusy ? 'disabled' : '';
    const freeBtn = d.onFreeRevive ? `<button id="btn-free-revive" class="race-btn" ${busy}>${art('heart')} 免费复活（${freeCount}）</button>` : '';
    const adBtn = d.onRewardedRevive ? `<button id="btn-revive" class="race-btn" ${busy}>${icon('play')} ${d.rewardBusy ? '广告准备中…' : '看广告复活'}</button>` : '';
    this.panel.innerHTML = `${art(d.finished ? 'star' : 'character_green_hit', 'result-art')}<div class="eyebrow">${d.finished ? 'JOURNEY COMPLETE' : 'ONE MORE ADVENTURE'}</div><h2>${d.finished ? '完赛！今天也很出色' : '撞毁了…再试一次吧'}</h2><div class="big">${d.finished ? (d.timeMs / 1000).toFixed(2) : d.score}<small>${d.finished ? 's' : '分'}</small></div><div class="row">${d.finished ? '把这段快乐旅途，留给今天的自己。' : '每一次出发，都比上一次更进一步。'}</div><div class="result-details"><span>${icon('ruler')}${d.distanceM}m</span><span>${art('gem_yellow')}${d.coins} 宝石</span><span>${icon('timer')}${(d.timeMs / 1000).toFixed(2)}s</span></div>${d.streak ? `<div class="row">连续完赛 ${d.streak}天</div>` : ''}${!d.finished && !d.onFreeRevive && !d.onRewardedRevive ? '<div class="row revive-hint">本轮暂无可用复活机会</div>' : ''}<div class="btns"><button id="btn-retry">${icon('rotate-ccw')}再跑一次</button>${freeBtn}${adBtn}</div><div class="btns"><button id="btn-talents-res" class="secondary-btn">${icon('zap')}天赋强化</button><button id="btn-card" class="secondary-btn">${icon('camera')}保存战报</button></div>`;
    document.getElementById('btn-retry')!.onclick = d.onRetry;
    const free = document.getElementById('btn-free-revive');
    if (free && d.onFreeRevive && !d.rewardBusy) free.onclick = d.onFreeRevive;
    const ad = document.getElementById('btn-revive');
    if (ad && d.onRewardedRevive && !d.rewardBusy) ad.onclick = d.onRewardedRevive;
    if (d.onTalents) document.getElementById('btn-talents-res')!.onclick = d.onTalents;
    document.getElementById('btn-card')!.onclick = d.onCard;
    this.resultEl.onclick = event => { if (event.target === this.resultEl) d.onRetry(); };
    this.open();
  }
  showWardrobe(skins: SkinDef[], totalCoins: number, currentId: string, onAction: (id: string) => void, onClose: () => void): void {
    this.resultEl.onclick = null;
    const cards = skins.map(s => {
      const equipped = s.id === currentId;
      const button = equipped ? '已装备' : s.unlocked ? '装备' : `${s.price} 宝石解锁`;
      return `<div class="skin-card ${equipped ? 'active' : ''}">${equipped ? '<span class="equipped-label">使用中</span>' : ''}<img class="s-preview" src="${localAsset(`kenney/character_${skinColor(s.id)}_front.png`)}" alt="${escapeHtml(s.name)}"><div class="s-name">${escapeHtml(s.name)}</div><div class="s-desc">${escapeHtml(s.desc)}</div><button class="s-btn ${equipped ? 'secondary-btn' : s.unlocked ? '' : 'race-btn'}" data-id="${s.id}">${button}</button></div>`;
    }).join('');
    this.panel.innerHTML = `<div class="eyebrow">FIND YOUR LITTLE COMPANION</div><h2>外观衣橱</h2>${this.wallet(totalCoins)}<div class="skin-grid">${cards}</div><div class="btns"><button id="btn-wclose" class="secondary-btn">返回旅途</button></div>`;
    for (const button of this.panel.querySelectorAll<HTMLButtonElement>('.s-btn')) button.onclick = () => onAction(button.dataset.id!);
    document.getElementById('btn-wclose')!.onclick = onClose;
    this.open();
  }
  showAchievements(list: AchievementDef[], onClose: () => void): void {
    this.resultEl.onclick = null;
    const items = list.map(a => `<div class="ach-item ${a.unlocked ? '' : 'locked'}"><div class="a-icon">${art('star')}</div><div class="a-info"><div class="a-title">${escapeHtml(a.title)}</div><div class="a-desc">${escapeHtml(a.desc)}</div></div><span class="a-status ${a.unlocked ? 'done' : ''}">${a.unlocked ? '已达成' : '未解锁'}</span></div>`).join('');
    this.panel.innerHTML = `<div class="eyebrow">LITTLE STEPS, GREAT MOMENTS</div><h2>荣誉成就</h2><div class="row">每一份努力，都值得被记住</div><div class="ach-list">${items}</div><div class="btns"><button id="btn-aclose" class="secondary-btn">返回旅途</button></div>`;
    document.getElementById('btn-aclose')!.onclick = onClose;
    this.open();
  }
  showTalents(talents: import('./talents.js').TalentDef[], totalCoins: number, onUpgrade: (id: string) => void, onClose: () => void): void {
    this.resultEl.onclick = null;
    const cards = talents.map((t, index) => {
      const max = t.level >= t.maxLevel;
      const cost = max ? 0 : t.costs[t.level]!;
      return `<div class="skin-card"><div class="talent-title">${icon(['shield', 'magnet', 'sparkles', 'zap'][index % 4]!)}<div><div class="s-name">${escapeHtml(t.name)}</div><div class="talent-level">LEVEL ${t.level} / ${t.maxLevel}</div></div></div><div class="s-desc">${escapeHtml(t.desc)}</div><div class="talent-current">当前：${escapeHtml(t.level > 0 ? t.effects[t.level - 1]! : '未激活')}</div>${!max ? `<div class="talent-next">下级：${escapeHtml(t.effects[t.level]!)}</div>` : ''}<button class="s-btn ${max || totalCoins < cost ? 'secondary-btn' : 'race-btn'}" data-id="${t.id}" ${max || totalCoins < cost ? 'disabled' : ''}>${max ? '已满级' : `${cost} 宝石升级`}</button></div>`;
    }).join('');
    this.panel.innerHTML = `<div class="eyebrow">A LITTLE STRONGER, EVERY DAY</div><h2>单机天赋强化</h2>${this.wallet(totalCoins)}<div class="skin-grid">${cards}</div><div class="btns"><button id="btn-tclose" class="secondary-btn">返回旅途</button></div>`;
    for (const button of this.panel.querySelectorAll<HTMLButtonElement>('.s-btn:not([disabled])')) button.onclick = () => onUpgrade(button.dataset.id!);
    document.getElementById('btn-tclose')!.onclick = onClose;
    this.open();
  }
  private wallet(coins: number): string { return `<div class="wallet">${art('gem_yellow')}当前资产 <b>${coins}</b> 宝石</div>`; }
  private open(): void { this.panel.scrollTop = 0; this.resultEl.classList.add('show'); }
  hideResult(): void { this.resultEl.classList.remove('show'); }
  isModalOpen(): boolean { return this.resultEl.classList.contains('show'); }
}
