import { makeInput, type InputByte } from '@dashline/shared';

/**
 * 输入缓冲：把"人手时刻"翻译成"逻辑 tick 字节"。
 * 支持跳跃、长按蓄力、空中急速下砸（S / ↓ / 下滑）、空中破风冲刺（D / Shift / 右滑 / 双击）。
 */
export class InputBuffer {
  private presses = 0;
  private held = false;
  private downHeld = false;
  private dashPresses = 0;

  private restartHandlers: Array<() => void> = [];
  private pauseHandlers: Array<() => void> = [];
  private actionHandlers: Array<() => void> = [];

  // 触屏手势状态
  private pointerStartX = 0;
  private pointerStartY = 0;
  private pointerStartTime = 0;
  private lastTapTime = 0;

  attach(canvas: HTMLCanvasElement): () => void {
    const isJumpKey = (e: KeyboardEvent): boolean =>
      e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW';

    const isDownKey = (e: KeyboardEvent): boolean =>
      e.code === 'ArrowDown' || e.code === 'KeyS';

    const isDashKey = (e: KeyboardEvent): boolean =>
      e.code === 'KeyD' || e.code === 'ArrowRight' || e.code === 'ShiftLeft' || e.code === 'ShiftRight';

    const kd = (e: KeyboardEvent): void => {
      if (isJumpKey(e)) {
        e.preventDefault();
        if (!e.repeat) {
          this.presses++;
          for (const h of this.actionHandlers) h();
        }
        this.held = true;
      } else if (isDownKey(e)) {
        e.preventDefault();
        this.downHeld = true;
      } else if (isDashKey(e)) {
        e.preventDefault();
        if (!e.repeat) {
          this.dashPresses++;
        }
      } else if (e.code === 'KeyR' || e.code === 'Enter') {
        for (const h of this.restartHandlers) h();
      } else if (e.code === 'KeyP' || e.code === 'Escape') {
        for (const h of this.pauseHandlers) h();
      }
    };

    const ku = (e: KeyboardEvent): void => {
      if (isJumpKey(e)) this.held = false;
      if (isDownKey(e)) this.downHeld = false;
    };

    const pd = (e: PointerEvent): void => {
      e.preventDefault();
      const now = performance.now();
      this.pointerStartX = e.clientX;
      this.pointerStartY = e.clientY;
      this.pointerStartTime = now;

      // 快速双击判定空中冲刺
      if (now - this.lastTapTime < 240) {
        this.dashPresses++;
      }
      this.lastTapTime = now;

      this.presses++;
      this.held = true;
      for (const h of this.actionHandlers) h();
    };

    const pm = (e: PointerEvent): void => {
      if (!this.held) return;
      const dy = e.clientY - this.pointerStartY;
      const dx = e.clientX - this.pointerStartX;
      if (dy > 30 && Math.abs(dy) > Math.abs(dx)) {
        this.downHeld = true; // 向下滑动手势触发极速下砸
      }
    };

    const pu = (e: PointerEvent): void => {
      const dx = e.clientX - this.pointerStartX;
      const dy = e.clientY - this.pointerStartY;
      const dt = performance.now() - this.pointerStartTime;
      if (dt < 280 && dx > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        this.dashPresses++; // 向右快速滑动手势触发冲刺
      }

      this.held = false;
      this.downHeld = false;
    };

    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    canvas.addEventListener('pointerdown', pd);
    canvas.addEventListener('pointermove', pm);
    window.addEventListener('pointerup', pu);
    window.addEventListener('pointercancel', pu);

    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      canvas.removeEventListener('pointerdown', pd);
      canvas.removeEventListener('pointermove', pm);
      window.removeEventListener('pointerup', pu);
      window.removeEventListener('pointercancel', pu);
    };
  }

  onRestart(h: () => void): void {
    this.restartHandlers.push(h);
  }

  onAction(h: () => void): void {
    this.actionHandlers.push(h);
  }

  onPause(h: () => void): void {
    this.pauseHandlers.push(h);
  }

  triggerDash(): void {
    this.dashPresses++;
  }

  triggerSlam(): void {
    this.downHeld = true;
  }

  releaseSlam(): void {
    this.downHeld = false;
  }

  /** 取本 tick 的输入字节（边沿只被消费一次） */
  poll(): InputByte {
    const press = this.presses > 0;
    if (press) this.presses--;
    const dash = this.dashPresses > 0;
    if (dash) this.dashPresses--;

    return makeInput(press, press || this.held, this.downHeld, dash);
  }

  /** 切后台/失焦时清空按住状态，防止恢复后"卡住跳跃" */
  resetHeld(): void {
    this.held = false;
    this.presses = 0;
    this.downHeld = false;
    this.dashPresses = 0;
  }
}
