/**
 * 4399 原创平台 H5小游戏（h5mini-2.0）官方 API 适配器。
 *
 * 依据官方接入文档与 SDK 源码（h5api-interface.php 加载
 * cdn.h5wan.4399sj.com/h5mini-2.0/dist/static/js/api.js）：
 * - `window.h5api.canPlayAd(cb)`：cb 收到 `{ canPlayAd: boolean, remain: number }`，
 *   官方要求据此决定是否展示广告入口；
 * - `window.h5api.playAd(cb)`：cb 收到 `{ code, message }`，
 *   10000=开始播放、10001=播放结束、10010=播放异常，回调可能多次触发；
 * - `window.h5api.progress(1~100)`：向平台进度条上报加载进度；
 * - `window.h5api.playInterstitialAd()`：插屏广告，无回调。
 * 排行榜、云存档、登录等能力第一版按计划不接入。
 *
 * 所有方法都代理到宿主 iframe 的 `parent.h5api`，本地直开或非 4399
 * 宿主时调用会抛错，因此每个入口都必须可安全失败并降级。
 */
import { PLATFORM_CONFIG } from './platform-config.js';
import type { AdResult, GamePlatform } from './platform.js';

/** 官方 h5mini-2.0 API 中当前用到的最小子集。 */
export interface H5MiniApi {
  progress?(num: number): void;
  canPlayAd?(callback: (data: { canPlayAd?: boolean; remain?: number }) => void): boolean | void;
  playAd?(callback: (state: { code?: number; message?: string }) => void): void;
  playInterstitialAd?(): void;
}

type H5MiniHost = typeof globalThis & { h5api?: H5MiniApi };

/** 4399 h5mini-2.0 playAd 状态码（官方文档定义）。 */
export const H5_AD_CODE = {
  /** 开始播放（中间状态，继续等待终态）。 */
  START: 10_000,
  /** 播放结束（唯一可发放奖励的终态）。 */
  FINISH: 10_001,
  /** 播放异常（不发放奖励）。 */
  ERROR: 10_010,
} as const;

/** 游戏是否被嵌入宿主页面；4399 平台以 iframe 方式承载 H5小游戏。 */
export function isEmbedded(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent !== window;
  } catch {
    return false;
  }
}

/** SDK 就绪标志：真实 api.js 覆盖 stub 后才具备 playAd。 */
function currentApi(): H5MiniApi | undefined {
  const api = (globalThis as H5MiniHost).h5api;
  return api && typeof api.playAd === 'function' ? api : undefined;
}

/** 轮询等待官方 SDK 就绪；超时或异常都返回 undefined，绝不抛错。 */
function waitForApi(deadline: number): Promise<H5MiniApi | undefined> {
  return new Promise((resolve) => {
    const direct = currentApi();
    if (direct) {
      resolve(direct);
      return;
    }
    const timer = setInterval(() => {
      const api = currentApi();
      if (api) {
        clearInterval(timer);
        resolve(api);
        return;
      }
      if (Date.now() >= deadline) {
        clearInterval(timer);
        resolve(undefined);
      }
    }, 50);
  });
}

/** 动态注入官方 SDK 脚本；已注入或环境不支持时静默跳过。 */
function injectSdkScript(url: string): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`script[src="${url}"]`)) return;
  try {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    document.head.appendChild(script);
  } catch {
    /* 注入失败按本地模式降级 */
  }
}

/** 4399 H5小游戏（h5mini-2.0）平台实现。 */
export class H5MiniPlatform implements GamePlatform {
  readonly kind = '4399' as const;
  private api: H5MiniApi | undefined;
  private adsAvailable = false;
  private adsProbeId = 0;

  /**
   * @param attempt - 是否尝试接入官方 SDK（'4399' 模式强制、auto 模式需嵌入
   * iframe）；为 false 时 init 直接跳过，行为等同本地模式。
   */
  constructor(private readonly attempt = true) {}

  async init(): Promise<void> {
    if (!PLATFORM_CONFIG.enabled || !this.attempt) return;
    // 脚本加载与库存探测共享同一预算，保证 init 最长阻塞 initTimeoutMs
    const deadline = Date.now() + PLATFORM_CONFIG.initTimeoutMs;
    try {
      if (!currentApi()) injectSdkScript(PLATFORM_CONFIG.sdkUrl);
      this.api = await waitForApi(deadline);
    } catch {
      this.api = undefined;
    }
    if (this.api) {
      const remaining = deadline - Date.now();
      if (remaining > 0) await this.updateAdsAvailability(remaining);
    }
  }

  isAvailable(): boolean {
    return this.api !== undefined && this.adsAvailable;
  }

  /** 官方要求：通过 canPlayAd 决定是否展示广告入口。 */
  private probeAds(timeoutMs: number): Promise<boolean> {
    const api = this.api;
    if (!api || typeof api.canPlayAd !== 'function') return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      try {
        api.canPlayAd!((data) => done(data?.canPlayAd === true));
      } catch {
        done(false);
      }
    });
  }

  /** 只允许最后发起的库存探测更新状态，避免异步回调乱序覆盖新结果。 */
  private async updateAdsAvailability(timeoutMs: number): Promise<boolean> {
    const probeId = ++this.adsProbeId;
    const ok = await this.probeAds(timeoutMs);
    if (probeId === this.adsProbeId) this.adsAvailable = ok;
    return this.adsAvailable;
  }

  /** 刷新广告库存状态，并把最新状态返回给调用方以便同步界面。 */
  async refreshAds(): Promise<boolean> {
    if (!this.api) {
      this.adsAvailable = false;
      return false;
    }
    return this.updateAdsAvailability(PLATFORM_CONFIG.initTimeoutMs);
  }

  async showRewardedAd(_placement: string): Promise<AdResult> {
    const api = this.api;
    if (!api || typeof api.playAd !== 'function') return 'unavailable';
    // 播放前重新探测：无库存直接返回 unavailable，不消耗本局复活机会
    this.adsAvailable = await this.updateAdsAvailability(PLATFORM_CONFIG.initTimeoutMs);
    if (!this.adsAvailable) return 'unavailable';
    const result = await new Promise<AdResult>((resolve) => {
      let settled = false;
      const finish = (value: AdResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish('failed'), PLATFORM_CONFIG.adTimeoutMs);
      try {
        api.playAd!((state) => {
          const code = state?.code;
          if (code === H5_AD_CODE.FINISH) finish('completed');
          else if (code === H5_AD_CODE.ERROR) finish('failed');
          // 10000=开始播放：中间状态，等待终态或超时
        });
      } catch {
        finish('failed');
      }
    });
    void this.refreshAds();
    return result;
  }

  async showInterstitialAd(_placement: string): Promise<AdResult> {
    // 官方插屏接口无回调；第一版按计划默认不启用，仅保留联调通路
    const api = this.api;
    if (!api || typeof api.playInterstitialAd !== 'function') return 'unavailable';
    try {
      api.playInterstitialAd();
      return 'completed';
    } catch {
      return 'failed';
    }
  }

  track(_event: string, _data?: Record<string, string | number | boolean>): void {
    /* h5mini-2.0 无通用统计接口，第一版保持空实现 */
  }

  /** 向平台进度条上报资源加载进度（1~100）。 */
  reportLoadProgress(percent: number): void {
    try {
      const clamped = Math.max(1, Math.min(100, Math.round(percent)));
      this.api?.progress?.(clamped);
    } catch {
      /* 进度上报失败不影响游戏 */
    }
  }
}
