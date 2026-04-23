/**
 * Raw keyboard listener.
 *
 * Listens to `keydown` / `keyup` on a target window and translates
 * the events into:
 *   - one-shot `InputAction` events (for taps, rotations, soft-drop edges)
 *   - a `pressed` set of currently-held `BindableAction`s (so that the
 *     DAS/ARR generator can turn a long press into repeated MOVE_L/R)
 *
 * All translation is frame-agnostic; the caller consumes batches per
 * game frame via `consume()`.
 */

import type { InputAction } from '@chaindrop/shared';
import { type BindableAction, type Keybindings, buildKeyToAction } from './keybindings';

/**
 * A tiny EventTarget-shaped surface, so that tests can supply a
 * custom dispatcher without needing a full DOM.
 */
export interface KeyboardTarget {
  addEventListener(type: 'keydown' | 'keyup', listener: (ev: KeyboardEvent) => void): void;
  removeEventListener(type: 'keydown' | 'keyup', listener: (ev: KeyboardEvent) => void): void;
}

export interface KeyboardFrame {
  /** Fire-and-forget events emitted since the last `consume()`. */
  events: InputAction[];
  /** Actions held down at the moment of the call. */
  pressed: ReadonlySet<BindableAction>;
}

export class KeyboardInput {
  private readonly pressed = new Set<BindableAction>();
  private pendingEvents: InputAction[] = [];
  private detachFn: (() => void) | null = null;
  private keyToAction: Map<string, BindableAction>;

  constructor(private bindings: Keybindings) {
    this.keyToAction = buildKeyToAction(bindings);
  }

  /** Re-wire to a new set of bindings. Current `pressed` state is cleared. */
  setBindings(bindings: Keybindings): void {
    this.bindings = bindings;
    this.keyToAction = buildKeyToAction(bindings);
    this.pressed.clear();
    this.pendingEvents = [];
  }

  /** Attach keyboard listeners. Returns a detach function. */
  attach(target: KeyboardTarget): () => void {
    if (this.detachFn) this.detachFn();

    const onDown = (e: KeyboardEvent) => {
      const action = this.keyToAction.get(e.code);
      if (!action) return;
      e.preventDefault();
      if (this.pressed.has(action)) return; // ignore OS auto-repeat
      this.pressed.add(action);
      this.onActionDown(action);
    };
    const onUp = (e: KeyboardEvent) => {
      const action = this.keyToAction.get(e.code);
      if (!action) return;
      e.preventDefault();
      if (!this.pressed.has(action)) return;
      this.pressed.delete(action);
      this.onActionUp(action);
    };

    target.addEventListener('keydown', onDown);
    target.addEventListener('keyup', onUp);
    this.detachFn = () => {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
    };
    return this.detachFn;
  }

  /** Drain pending events and return the current `pressed` snapshot. */
  consume(): KeyboardFrame {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return { events, pressed: this.pressed };
  }

  /** Release everything and detach listeners. Idempotent. */
  dispose(): void {
    if (this.detachFn) {
      this.detachFn();
      this.detachFn = null;
    }
    this.pressed.clear();
    this.pendingEvents = [];
  }

  // ---- translations ----

  private onActionDown(action: BindableAction): void {
    switch (action) {
      case 'MOVE_L':
        this.pendingEvents.push('MOVE_L');
        break;
      case 'MOVE_R':
        this.pendingEvents.push('MOVE_R');
        break;
      case 'ROT_L':
        this.pendingEvents.push('ROT_L');
        break;
      case 'ROT_R':
        this.pendingEvents.push('ROT_R');
        break;
      case 'SOFT_DROP':
        this.pendingEvents.push('SOFT_START');
        break;
      case 'PAUSE':
        // PAUSE is not a simulator input; scenes handle it separately.
        break;
    }
  }

  private onActionUp(action: BindableAction): void {
    if (action === 'SOFT_DROP') {
      this.pendingEvents.push('SOFT_END');
    }
  }
}
