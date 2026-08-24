import { makeInput, type InputByte } from '@dashline/shared';

/**
 * 输入缓冲：把"人手时刻"翻译成"逻辑 tick 字节"。
 * 同一帧内的多次子步只会消费一个按下边沿（第一次 poll），其余 tick 只看到 held 电平。
 */
export class InputBuffer {
  private presses = 0;
  private held = false;
  private restartHandlers: Array<() => void> = [];

  attach(canvas: HTMLCanvasElement): () => void {
    const isJumpKey = (e: KeyboardEvent): boolean =>
      e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW';

    const kd = (e: KeyboardEvent): void => {
      if (isJumpKey(e)) {
        e.preventDefault();
        if (!e.repeat) this.presses++;
        this.held = true;
      } else if (e.code === 'KeyR') {
        for (const h of this.restartHandlers) h();
      }
    };
    const ku = (e: KeyboardEvent): void => {
      if (isJumpKey(e)) this.held = false;
    };
    const pd = (e: PointerEvent): void => {
      e.preventDefault();
      this.presses++;
      this.held = true;
    };
    const pu = (): void => {
      this.held = false;
    };

    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    canvas.addEventListener('pointerdown', pd);
    window.addEventListener('pointerup', pu);
    window.addEventListener('pointercancel', pu);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      canvas.removeEventListener('pointerdown', pd);
      window.removeEventListener('pointerup', pu);
      window.removeEventListener('pointercancel', pu);
    };
  }

  onRestart(h: () => void): void {
    this.restartHandlers.push(h);
  }

  /** 取本 tick 的输入字节（边沿只被消费一次） */
  poll(): InputByte {
    const press = this.presses > 0;
    if (press) this.presses--;
    return makeInput(press, press || this.held);
  }

  /** 切后台/失焦时清空按住状态，防止恢复后"卡住跳跃" */
  resetHeld(): void {
    this.held = false;
    this.presses = 0;
  }
}
