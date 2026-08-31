import {
  IN_DASH_PRESS,
  IN_DOWN_HELD,
  IN_JUMP_HELD,
  IN_JUMP_PRESS,
} from './constants.js';

export type InputByte = number;

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
