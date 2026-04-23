/**
 * InputSystem — orchestrates KeyboardInput + DasArr into a per-frame
 * `InputAction[]` stream that the simulator consumes.
 */

import type { InputAction } from '@chaindrop/shared';
import { DasArr, type DasArrOptions } from './DasArr';
import { KeyboardInput, type KeyboardTarget } from './KeyboardInput';
import { DEFAULT_KEYBINDINGS, type Keybindings } from './keybindings';

export interface InputSystemOptions {
  bindings?: Keybindings;
  das?: number;
  arr?: number;
}

export class InputSystem {
  readonly keyboard: KeyboardInput;
  readonly dasArr: DasArr;

  constructor(opts: InputSystemOptions = {}) {
    this.keyboard = new KeyboardInput(opts.bindings ?? DEFAULT_KEYBINDINGS);
    this.dasArr = new DasArr({ das: opts.das ?? 15, arr: opts.arr ?? 3 });
  }

  attach(target: KeyboardTarget): () => void {
    return this.keyboard.attach(target);
  }

  /** Drain pending events + DAS/ARR repeats. Call once per game frame. */
  consume(): InputAction[] {
    const { events, pressed } = this.keyboard.consume();
    const repeats = this.dasArr.tick(pressed);
    return [...events, ...repeats];
  }

  setBindings(bindings: Keybindings): void {
    this.keyboard.setBindings(bindings);
    this.dasArr.reset();
  }

  setTiming(opts: DasArrOptions): void {
    this.dasArr.setTiming(opts);
  }

  dispose(): void {
    this.keyboard.dispose();
    this.dasArr.reset();
  }
}
