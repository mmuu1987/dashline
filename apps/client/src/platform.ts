/**
 * 平台能力的最小边界。
 * 4399 SDK 的具体字段由平台文档决定，客户端只依赖这个稳定接口。
 */
import { PLATFORM_CONFIG } from './platform-config.js';
import { H5MiniPlatform, isEmbedded } from './platform-h5mini.js';

export type AdResult = 'completed' | 'cancelled' | 'unavailable' | 'failed';

export interface PlatformBridge {
  init?: () => void | Promise<void>;
  showRewardedAd?: (placement: string) => void | Promise<AdResult>;
  showInterstitialAd?: (placement: string) => void | Promise<AdResult>;
  track?: (event: string, data?: Record<string, string | number | boolean>) => void;
}

export interface GamePlatform {
  readonly kind: 'local' | '4399';
  init(): Promise<void>;
  isAvailable(): boolean;
  showRewardedAd(placement: string): Promise<AdResult>;
  showInterstitialAd(placement: string): Promise<AdResult>;
  track(event: string, data?: Record<string, string | number | boolean>): void;
  /** 后台刷新广告库存（官方 canPlayAd）；仅真实平台需要，缺省为空操作。 */
  refreshAds?(): void;
  /** 向平台进度条上报加载进度（1~100）；缺省为空操作。 */
  reportLoadProgress?(percent: number): void;
}

class LocalPlatform implements GamePlatform {
  readonly kind = 'local' as const;
  async init(): Promise<void> { /* no-op */ }
  isAvailable(): boolean { return false; }
  async showRewardedAd(_placement: string): Promise<AdResult> { return 'unavailable'; }
  async showInterstitialAd(_placement: string): Promise<AdResult> { return 'unavailable'; }
  track(_event: string, _data?: Record<string, string | number | boolean>): void { /* no-op */ }
}

async function adWithTimeout(task: void | Promise<AdResult>): Promise<AdResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(task).then((result) => result ?? 'failed'),
      new Promise<AdResult>((resolve) => {
        timeout = setTimeout(() => resolve('failed'), PLATFORM_CONFIG.adTimeoutMs);
      }),
    ]);
  } catch {
    return 'failed';
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

class BridgePlatform implements GamePlatform {
  readonly kind = '4399' as const;
  private ready = false;

  constructor(private readonly bridge: PlatformBridge) {}

  async init(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const task = Promise.resolve(this.bridge.init?.());
      await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('平台初始化超时')), PLATFORM_CONFIG.initTimeoutMs);
        }),
      ]);
      this.ready = true;
    } catch {
      this.ready = false;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  isAvailable(): boolean { return this.ready && typeof this.bridge.showRewardedAd === 'function'; }
  async showRewardedAd(placement: string): Promise<AdResult> {
    if (!this.isAvailable() || !this.bridge.showRewardedAd) return 'unavailable';
    return adWithTimeout(this.bridge.showRewardedAd(placement));
  }
  async showInterstitialAd(placement: string): Promise<AdResult> {
    if (!this.ready || !this.bridge.showInterstitialAd) return 'unavailable';
    return adWithTimeout(this.bridge.showInterstitialAd(placement));
  }
  track(event: string, data?: Record<string, string | number | boolean>): void {
    try { this.bridge.track?.(event, data); } catch { /* 统计失败不得影响游戏 */ }
  }
}

/**
 * 平台选择优先级：
 * 1. 官方 4399 H5小游戏 SDK（h5mini-2.0）——auto 模式仅在嵌入 iframe 时尝试；
 * 2. 宿主注入的 window.__DASHLINE_PLATFORM__ 桥（浏览器测试与自定义宿主联调用）；
 * 3. 本地模式：不发起任何网络请求，广告一律不可用。
 */
export function createPlatform(): GamePlatform {
  if (!PLATFORM_CONFIG.enabled) return new LocalPlatform();
  // 官方 SDK：'4399' 模式强制接入（平台预览联调）；auto 模式仅在嵌入 iframe 时接入
  if (PLATFORM_CONFIG.mode === '4399') return new H5MiniPlatform(true);
  if (isEmbedded()) return new H5MiniPlatform(true);
  const bridge = (globalThis as typeof globalThis & { __DASHLINE_PLATFORM__?: PlatformBridge }).__DASHLINE_PLATFORM__;
  return bridge ? new BridgePlatform(bridge) : new LocalPlatform();
}
