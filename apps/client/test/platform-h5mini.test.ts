import { afterEach, describe, expect, it, vi } from 'vitest';
import { H5MiniPlatform, H5_AD_CODE, type H5MiniApi } from '../src/platform-h5mini.js';

declare global {
  // 模拟 4399 原创平台注入的官方 h5api。
  var h5api: H5MiniApi | undefined;
}

afterEach(() => {
  delete globalThis.h5api;
  vi.useRealTimers();
});

function makeApi(overrides: Partial<H5MiniApi> = {}): H5MiniApi {
  return {
    canPlayAd: (cb) => cb({ canPlayAd: true, remain: 3 }),
    playAd: (cb) => {
      cb({ code: H5_AD_CODE.START, message: '开始播放' });
      cb({ code: H5_AD_CODE.FINISH, message: '播放结束' });
    },
    progress: () => undefined,
    ...overrides,
  };
}

describe('4399 H5小游戏（h5mini-2.0）官方适配', () => {
  it('SDK 就绪且有库存时可用；只有 10001 播放结束才发放奖励', async () => {
    globalThis.h5api = makeApi();
    const platform = new H5MiniPlatform(true);
    await platform.init();
    expect(platform.kind).toBe('4399');
    expect(platform.isAvailable()).toBe(true);
    await expect(platform.showRewardedAd('revive')).resolves.toBe('completed');
  });

  it('canPlayAd 无库存时返回 unavailable，不进入播放流程', async () => {
    globalThis.h5api = makeApi({
      canPlayAd: (cb) => cb({ canPlayAd: false, remain: 0 }),
      playAd: () => {
        throw new Error('不应播放广告');
      },
    });
    const platform = new H5MiniPlatform(true);
    await platform.init();
    expect(platform.isAvailable()).toBe(false);
    await expect(platform.showRewardedAd('revive')).resolves.toBe('unavailable');
  });

  it('10010 播放异常不发放奖励', async () => {
    globalThis.h5api = makeApi({
      playAd: (cb) => {
        cb({ code: H5_AD_CODE.START, message: '开始播放' });
        cb({ code: H5_AD_CODE.ERROR, message: '播放异常' });
      },
    });
    const platform = new H5MiniPlatform(true);
    await platform.init();
    await expect(platform.showRewardedAd('revive')).resolves.toBe('failed');
  });

  it('playAd 同步抛错时安全降级为 failed', async () => {
    globalThis.h5api = makeApi({
      playAd: () => {
        throw new Error('parent.h5api 不可用');
      },
    });
    const platform = new H5MiniPlatform(true);
    await platform.init();
    await expect(platform.showRewardedAd('revive')).resolves.toBe('failed');
  });

  it('SDK 缺失时初始化超时后保持降级，不抛错', async () => {
    vi.useFakeTimers();
    const platform = new H5MiniPlatform(true);
    const initPromise = platform.init();
    await vi.advanceTimersByTimeAsync(3_000);
    await initPromise;
    expect(platform.isAvailable()).toBe(false);
    await expect(platform.showRewardedAd('revive')).resolves.toBe('unavailable');
  });

  it('canPlayAd 不回调时按超时降级为不可用', async () => {
    vi.useFakeTimers();
    globalThis.h5api = makeApi({
      canPlayAd: () => undefined,
      playAd: () => {
        throw new Error('不应播放广告');
      },
    });
    const platform = new H5MiniPlatform(true);
    const initPromise = platform.init();
    await vi.advanceTimersByTimeAsync(3_000);
    await initPromise;
    expect(platform.isAvailable()).toBe(false);
  });

  it('脚本就绪耗时较长时，库存探测只使用剩余预算，总阻塞不超过 2.5 秒', async () => {
    vi.useFakeTimers();
    const platform = new H5MiniPlatform(true);
    const initPromise = platform.init();
    // SDK 在 2400ms 才就绪，几乎吃满初始化预算
    setTimeout(() => {
      globalThis.h5api = makeApi({ canPlayAd: () => undefined });
    }, 2_400);
    await vi.advanceTimersByTimeAsync(2_400);
    // 轮询在下个 50ms 捕获就绪，随后探测只剩 ~100ms 预算
    await vi.advanceTimersByTimeAsync(300);
    await initPromise;
    expect(platform.isAvailable()).toBe(false);
    // 总阻塞约 2.5s：继续推进不应再有任何 pending 探测
    await vi.advanceTimersByTimeAsync(5_000);
  });

  it('广告播放完成后刷新库存，无库存时下次入口不可用', async () => {
    let remain = 1;
    globalThis.h5api = makeApi({
      canPlayAd: (cb) => cb({ canPlayAd: remain > 0, remain }),
      playAd: (cb) => {
        remain = 0;
        cb({ code: H5_AD_CODE.FINISH, message: '播放结束' });
      },
    });
    const platform = new H5MiniPlatform(true);
    await platform.init();
    expect(platform.isAvailable()).toBe(true);
    await expect(platform.showRewardedAd('revive')).resolves.toBe('completed');
    expect(platform.isAvailable()).toBe(false);
  });

  it('reportLoadProgress 将进度裁剪到 1~100 并转发给平台进度条', async () => {
    const progress = vi.fn();
    globalThis.h5api = makeApi({ progress });
    const platform = new H5MiniPlatform(true);
    await platform.init();
    platform.reportLoadProgress?.(0);
    platform.reportLoadProgress?.(47.6);
    platform.reportLoadProgress?.(999);
    expect(progress).toHaveBeenNthCalledWith(1, 1);
    expect(progress).toHaveBeenNthCalledWith(2, 48);
    expect(progress).toHaveBeenNthCalledWith(3, 100);
  });

  it('插屏接口存在时调用成功，缺失时返回 unavailable', async () => {
    globalThis.h5api = makeApi({ playInterstitialAd: undefined });
    const platform = new H5MiniPlatform(true);
    await platform.init();
    await expect(platform.showInterstitialAd('interstitial')).resolves.toBe('unavailable');

    const play = vi.fn();
    globalThis.h5api = makeApi({ playInterstitialAd: play });
    const platform2 = new H5MiniPlatform(true);
    await platform2.init();
    await expect(platform2.showInterstitialAd('interstitial')).resolves.toBe('completed');
    expect(play).toHaveBeenCalledTimes(1);
  });
});
