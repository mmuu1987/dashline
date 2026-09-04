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

/** 读取当前 key；不存在时按顺序回退到旧 key，供平滑迁移使用。 */
export function lsGetFirst(keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = lsGet(key);
    if (value !== null) return value;
  }
  return null;
}

/** JSON 始终按未知输入处理，解析失败返回 undefined。 */
export function parseStoredJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toNonNegativeInteger(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)));
}

export function toBoundedInteger(
  value: unknown,
  min: number,
  max: number,
  fallback = min,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
