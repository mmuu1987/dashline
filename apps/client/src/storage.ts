/** 安全访问浏览器本地存储；隐私模式或容量异常时静默降级。 */
export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 本地存储不可用时仍允许继续游玩。
  }
}
