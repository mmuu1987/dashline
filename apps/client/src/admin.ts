/**
 * 管理员通道：解锁无限复活，仅供仓库所有者开发、自测与演示使用。
 *
 * ⚠️ 这不是权限校验。Dashline 是纯单机项目，没有服务端，口令随构建产物一起下发，
 * 任何人打开 DevTools 都能找到它。它的作用是「防普通玩家误触或顺手打开」，
 * 不是防破解。4399 正式运营包与审核包必须用 VITE_DASHLINE_ADMIN=0 构建，
 * 把整个通道（含口令字面量）从产物里编译掉。
 *
 * 用法：
 *   ?admin=<口令>   开启并记住（写入 localStorage）
 *   ?admin=off      关闭并清除
 *
 * 注意：下面的构建期判断刻意只做字面量比较、不调用任何方法，
 * 这样打包器才能在 VITE_DASHLINE_ADMIN=0 时把常量和口令一起折叠删除。
 */
import { lsGet, lsSet } from './storage.js';

/** 存档 key：只存 '1' / '0'，与每日复活额度分开。 */
const ADMIN_KEY = 'dl_admin_v1';

/** 构建期总开关：只有显式设为 '0' 才关闭。 */
const ADMIN_BUILD_ENABLED = import.meta.env.VITE_DASHLINE_ADMIN !== '0';

/** 开启口令；可用 VITE_DASHLINE_ADMIN_TOKEN 覆盖，默认值同时写在 docs/tech-architecture.md。 */
const ADMIN_TOKEN = import.meta.env.VITE_DASHLINE_ADMIN_TOKEN ?? 'dashline-admin';

const OFF_VALUES = ['0', 'off', 'false', 'no'];

/** `?admin=` 的解析结果：'on'=开启，'off'=关闭，null=本次不改变状态。 */
type AdminParam = 'on' | 'off' | null;

/**
 * 解析 `?admin=` 参数。口令不匹配时返回 null 而不是 'off'，
 * 避免打错口令反而把已经开启的通道关掉。
 */
function readAdminParam(search: string): AdminParam {
  if (!search) return null;
  const raw = new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get('admin');
  if (raw === null) return null;
  const value = raw.trim();
  if (OFF_VALUES.indexOf(value.toLowerCase()) >= 0) return 'off';
  return value.length > 0 && value === ADMIN_TOKEN ? 'on' : null;
}

/**
 * 管理员通道状态。构造时应用 URL 参数并持久化，
 * 之后每次进入游戏（不带参数）都沿用上次的选择。
 */
export class AdminChannel {
  private on: boolean;

  constructor(search: string) {
    if (!ADMIN_BUILD_ENABLED) {
      this.on = false;
      return;
    }
    const param = readAdminParam(search);
    if (param === null) {
      this.on = lsGet(ADMIN_KEY) === '1';
      return;
    }
    this.on = param === 'on';
    lsSet(ADMIN_KEY, this.on ? '1' : '0');
  }

  /** 管理员通道是否开启。 */
  isOn(): boolean {
    return this.on;
  }

  /** 当前管理员通道的唯一能力：跳过每日复活额度。 */
  unlimitedRevives(): boolean {
    return this.on;
  }
}
