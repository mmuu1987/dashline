import {
  IN_DASH_PRESS,
  IN_DOWN_HELD,
  IN_JUMP_HELD,
  IN_JUMP_PRESS,
} from './constants.js';

export type InputByte = number;

export interface RunPayload {
  scope: 'daily';
  date: string;
  score: number;
  finished: boolean;
  timeMs: number;
  distanceM: number;
  coins: number;
  attemptNo: number;
  clientVersion: string;
  /** RLE + base64url 的输入流（Ghost 回放 + 服务端重放的唯一原料） */
  inputsB64: string;
  /** sha256(seed|scope|blob) 前 16 hex，可选（M0 未启用） */
  inputsHash?: string;
}

export interface BoardEntry {
  rank: number;
  playerId: string;
  nickname: string;
  score: number;
  timeMs: number | null;
  you?: boolean;
}

export interface DailyInfo {
  date: string;
  seed: string;
  themeId: number;
  resetAtUtc: string;
}

export function makeInput(
  jumpPress: boolean,
  jumpHeld: boolean,
  downHeld = false,
  dashPress = false,
): InputByte {
  return (
    (jumpPress ? IN_JUMP_PRESS : 0) |
    (jumpHeld ? IN_JUMP_HELD : 0) |
    (downHeld ? IN_DOWN_HELD : 0) |
    (dashPress ? IN_DASH_PRESS : 0)
  );
}
