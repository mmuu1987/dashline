/** 逻辑帧率：全项目唯一的时间真相 */
export const TICK_RATE = 60;
export const STEP_MS = 1000 / TICK_RATE;
export const STEP_S = 1 / TICK_RATE;

/** core 物理法则版本：任何逻辑改动必须 bump，榜单按版本分桶 */
export const CORE_VERSION = 'core.5';
export const PROTOCOL_VERSION = 1;

/** 输入位掩码（每 tick 1 字节） */
export const IN_JUMP_PRESS = 1 << 0; // 边沿：本 tick 按下
export const IN_JUMP_HELD = 1 << 1; // 电平：持续按住
export const IN_DOWN_HELD = 1 << 2; // 预留：下滑

/** 手感参数（与 game-design.md §2 对应） */
export const COYOTE_TICKS = 7; // 土狼时间 ~117ms
export const BUFFER_TICKS = 8; // 预输入缓冲 ~133ms
export const HOLD_MAX_TICKS = 20; // 长按蓄力上限 ~333ms（满蓄高度 ≈ 2.05× 点按）
