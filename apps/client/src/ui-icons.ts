/** Local Lucide icons (ISC/MIT), shared by all DOM controls. */
export const localAsset = (path: string): string => import.meta.env.BASE_URL + `assets/${path}`;
export function icon(name: string, className = ''): string {
  return `<img class="ui-icon ${className}" src="${localAsset(`icons/${name}.svg`)}" alt="" aria-hidden="true" width="20" height="20">`;
}
export function art(name: string, className = ''): string {
  return `<img class="art-icon ${className}" src="${localAsset(`kenney/${name}.png`)}" alt="" aria-hidden="true">`;
}
export function setControl(button: HTMLElement, name: string, label: string, pressed = false): void {
  button.innerHTML = icon(name);
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(pressed));
  button.title = label;
}
export function setPauseControl(button: HTMLElement, paused: boolean): void {
  setControl(button, paused ? 'play' : 'pause', paused ? '继续游戏' : '暂停游戏', paused);
}
export function setMuteControl(button: HTMLElement, muted: boolean): void {
  setControl(button, muted ? 'volume-x' : 'volume-2', muted ? '开启声音' : '关闭声音', muted);
}
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
