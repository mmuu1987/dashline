import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlatform, type PlatformBridge } from '../src/platform.js';

declare global {
  // 测试宿主注入的最小平台桥。
  var __DASHLINE_PLATFORM__: PlatformBridge | undefined;
}

afterEach(() => {
  delete globalThis.__DASHLINE_PLATFORM__;
  vi.useRealTimers();
});

describe('平台桥接与降级', () => {
  it('没有宿主 SDK 时使用本地模式且广告不可用', async () => {
    const platform = createPlatform();
    await platform.init();
    expect(platform.kind).toBe('local');
    expect(platform.isAvailable()).toBe(false);
    await expect(platform.showRewardedAd('revive')).resolves.toBe('unavailable');
  });

  it('宿主桥初始化成功后转发激励广告', async () => {
    globalThis.__DASHLINE_PLATFORM__ = {
      init: vi.fn(),
      showRewardedAd: vi.fn(async () => 'completed'),
    };
    const platform = createPlatform();
    await platform.init();
    expect(platform.kind).toBe('4399');
    expect(platform.isAvailable()).toBe(true);
    await expect(platform.showRewardedAd('revive')).resolves.toBe('completed');
  });

  it('初始化或广告异常时安全降级，不向游戏抛错', async () => {
    globalThis.__DASHLINE_PLATFORM__ = {
      init: () => { throw new Error('sdk init failed'); },
      showRewardedAd: () => { throw new Error('ad failed'); },
    };
    const platform = createPlatform();
    await platform.init();
    expect(platform.isAvailable()).toBe(false);
    await expect(platform.showRewardedAd('revive')).resolves.toBe('unavailable');
  });

  it('桥初始化成功但广告方法同步抛错时解析为 failed', async () => {
    globalThis.__DASHLINE_PLATFORM__ = {
      init: () => undefined,
      showRewardedAd: () => { throw new Error('reward failed'); },
      showInterstitialAd: () => { throw new Error('interstitial failed'); },
    };
    const platform = createPlatform();
    await platform.init();
    await expect(platform.showRewardedAd('revive')).resolves.toBe('failed');
    await expect(platform.showInterstitialAd('result')).resolves.toBe('failed');
  });
});
