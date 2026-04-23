import { describe, expect, it } from 'vitest';
import { KeyboardInput, type KeyboardTarget } from './KeyboardInput';
import { DEFAULT_KEYBINDINGS } from './keybindings';

/**
 * Minimal EventTarget stub that matches the fragment of the DOM API
 * we actually use. Lets us drive the keyboard from tests without jsdom.
 */
class FakeTarget implements KeyboardTarget {
  private listeners = {
    keydown: new Set<(e: KeyboardEvent) => void>(),
    keyup: new Set<(e: KeyboardEvent) => void>(),
  };

  addEventListener(type: 'keydown' | 'keyup', fn: (e: KeyboardEvent) => void): void {
    this.listeners[type].add(fn);
  }

  removeEventListener(type: 'keydown' | 'keyup', fn: (e: KeyboardEvent) => void): void {
    this.listeners[type].delete(fn);
  }

  dispatch(type: 'keydown' | 'keyup', code: string): void {
    // Build a minimal KeyboardEvent-like object with the fields we use.
    const ev = {
      code,
      preventDefault() {
        // no-op
      },
    } as unknown as KeyboardEvent;
    for (const fn of this.listeners[type]) fn(ev);
  }

  listenerCount(type: 'keydown' | 'keyup'): number {
    return this.listeners[type].size;
  }
}

describe('KeyboardInput', () => {
  it('emits MOVE_L on ArrowLeft keydown', () => {
    const t = new FakeTarget();
    const k = new KeyboardInput(DEFAULT_KEYBINDINGS);
    k.attach(t);
    t.dispatch('keydown', 'ArrowLeft');
    const { events, pressed } = k.consume();
    expect(events).toEqual(['MOVE_L']);
    expect(pressed.has('MOVE_L')).toBe(true);
  });

  it('emits SOFT_START on ArrowDown keydown and SOFT_END on keyup', () => {
    const t = new FakeTarget();
    const k = new KeyboardInput(DEFAULT_KEYBINDINGS);
    k.attach(t);
    t.dispatch('keydown', 'ArrowDown');
    expect(k.consume().events).toEqual(['SOFT_START']);
    t.dispatch('keyup', 'ArrowDown');
    expect(k.consume().events).toEqual(['SOFT_END']);
  });

  it('emits ROT_L on Z keydown and ROT_R on X keydown', () => {
    const t = new FakeTarget();
    const k = new KeyboardInput(DEFAULT_KEYBINDINGS);
    k.attach(t);
    t.dispatch('keydown', 'KeyZ');
    t.dispatch('keydown', 'KeyX');
    expect(k.consume().events).toEqual(['ROT_L', 'ROT_R']);
  });

  it('ignores OS-level auto-repeat keydown events for the same key', () => {
    const t = new FakeTarget();
    const k = new KeyboardInput(DEFAULT_KEYBINDINGS);
    k.attach(t);
    t.dispatch('keydown', 'ArrowLeft');
    t.dispatch('keydown', 'ArrowLeft'); // auto-repeat
    t.dispatch('keydown', 'ArrowLeft');
    // Only the first keydown emits the tap.
    expect(k.consume().events).toEqual(['MOVE_L']);
  });

  it('does not emit PAUSE as a simulator input', () => {
    const t = new FakeTarget();
    const k = new KeyboardInput(DEFAULT_KEYBINDINGS);
    k.attach(t);
    t.dispatch('keydown', 'Escape');
    expect(k.consume().events).toEqual([]);
  });

  it('tracks pressed state across frames', () => {
    const t = new FakeTarget();
    const k = new KeyboardInput(DEFAULT_KEYBINDINGS);
    k.attach(t);
    t.dispatch('keydown', 'ArrowLeft');
    expect(k.consume().pressed.has('MOVE_L')).toBe(true);
    // Still pressed on the next frame.
    expect(k.consume().pressed.has('MOVE_L')).toBe(true);
    t.dispatch('keyup', 'ArrowLeft');
    expect(k.consume().pressed.has('MOVE_L')).toBe(false);
  });

  it('does not emit events for unbound keys', () => {
    const t = new FakeTarget();
    const k = new KeyboardInput(DEFAULT_KEYBINDINGS);
    k.attach(t);
    t.dispatch('keydown', 'KeyQ');
    expect(k.consume().events).toEqual([]);
  });

  it('dispose detaches listeners and clears state', () => {
    const t = new FakeTarget();
    const k = new KeyboardInput(DEFAULT_KEYBINDINGS);
    k.attach(t);
    expect(t.listenerCount('keydown')).toBe(1);
    k.dispose();
    expect(t.listenerCount('keydown')).toBe(0);
    expect(t.listenerCount('keyup')).toBe(0);
  });

  it('setBindings re-wires and clears previous state', () => {
    const t = new FakeTarget();
    const k = new KeyboardInput(DEFAULT_KEYBINDINGS);
    k.attach(t);
    t.dispatch('keydown', 'ArrowLeft');
    k.setBindings({ ...DEFAULT_KEYBINDINGS, MOVE_L: 'KeyA' });
    expect(k.consume().events).toEqual([]); // pending was cleared
    t.dispatch('keydown', 'KeyA');
    expect(k.consume().events).toEqual(['MOVE_L']);
  });
});
