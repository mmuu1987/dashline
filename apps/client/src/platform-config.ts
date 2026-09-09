/** 构建期平台开关；默认自动检测宿主桥，本地构建保持纯单机。 */
export type PlatformMode = 'auto' | '4399' | 'local' | 'off';

export interface PlatformConfig {
  /**
   * `auto`：仅在页面被嵌入 iframe（4399 平台承载方式）时尝试官方 H5小游戏 SDK；
   * `4399`：无条件尝试官方 SDK（供平台预览联调强制使用）；
   * `local` / `off`：完全不尝试，保持纯单机。
   */
  mode: PlatformMode;
  /** 是否允许任何平台能力（local/off 时为 false）。 */
  enabled: boolean;
  /** 4399 原创平台 H5小游戏（h5mini-2.0）官方接口脚本地址。 */
  sdkUrl: string;
  initTimeoutMs: number;
  adTimeoutMs: number;
}

const mode = String(import.meta.env.VITE_DASHLINE_PLATFORM ?? 'auto')
  .trim()
  .toLowerCase();

export const PLATFORM_CONFIG: PlatformConfig = {
  mode: (['auto', '4399', 'local', 'off'] as const).includes(mode as PlatformMode)
    ? (mode as PlatformMode)
    : 'auto',
  enabled: mode !== 'off' && mode !== 'local',
  sdkUrl: 'https://h.api.4399.com/h5mini-2.0/h5api-interface.php',
  initTimeoutMs: 2_500,
  adTimeoutMs: 30_000,
};
