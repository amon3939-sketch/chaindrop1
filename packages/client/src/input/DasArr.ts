/**
 * DAS (Delayed Auto-Shift) / ARR (Auto-Repeat Rate) generator.
 *
 * Translates a "held left or right" state into repeated `MOVE_L`/`MOVE_R`
 * events timed per-frame. The initial tap is NOT emitted here — that
 * fires as a one-shot from `KeyboardInput` on keydown.
 *
 *   frame 0: press detected (no emit from DAS)
 *   frames 1..das-1: quiet
 *   frame das:     emit 1st repeat
 *   frame das + n*arr: emit subsequent repeats
 *
 * Default (per D9): das = 15 frames, arr = 3 frames.
 */

import type { InputAction } from '@chaindrop/shared';
import type { BindableAction } from './keybindings';

export interface DasArrOptions {
  das?: number;
  arr?: number;
}

export class DasArr {
  private holding: 'MOVE_L' | 'MOVE_R' | null = null;
  private holdFrames = 0;

  constructor(private opts: Required<DasArrOptions> = { das: 15, arr: 3 }) {}

  /** Adjust timing at runtime (e.g. from settings). */
  setTiming(opts: DasArrOptions): void {
    this.opts = {
      das: opts.das ?? this.opts.das,
      arr: opts.arr ?? this.opts.arr,
    };
  }

  /** Called once per game frame. Returns the MOVE events to emit. */
  tick(pressed: ReadonlySet<BindableAction>): InputAction[] {
    // Priority: left beats right when both are held.
    const nowHolding: 'MOVE_L' | 'MOVE_R' | null = pressed.has('MOVE_L')
      ? 'MOVE_L'
      : pressed.has('MOVE_R')
        ? 'MOVE_R'
        : null;

    if (nowHolding !== this.holding) {
      this.holding = nowHolding;
      this.holdFrames = 0;
    }

    if (this.holding === null) return [];

    // The very first tick after a press counts as hold-frame 1 —
    // matching the natural reading of "DAS=15 means emit on the
    // 15th frame after pressing".
    this.holdFrames++;
    const { das, arr } = this.opts;
    if (this.holdFrames === das) return [this.holding];
    if (this.holdFrames > das && (this.holdFrames - das) % arr === 0) return [this.holding];
    return [];
  }

  reset(): void {
    this.holding = null;
    this.holdFrames = 0;
  }
}
