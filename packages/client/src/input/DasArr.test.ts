import { describe, expect, it } from 'vitest';
import { DasArr } from './DasArr';
import type { BindableAction } from './keybindings';

function heldSet(actions: BindableAction[]): Set<BindableAction> {
  return new Set(actions);
}

describe('DasArr', () => {
  it('emits nothing while no direction is held', () => {
    const d = new DasArr({ das: 15, arr: 3 });
    for (let i = 0; i < 20; i++) {
      expect(d.tick(heldSet([]))).toEqual([]);
    }
  });

  it('waits DAS frames before the first repeat', () => {
    const d = new DasArr({ das: 15, arr: 3 });
    const p = heldSet(['MOVE_L']);
    // Frames 1..14 (holdFrames 1..14) → quiet
    for (let i = 1; i <= 14; i++) {
      expect(d.tick(p)).toEqual([]);
    }
    // Frame 15 (holdFrames = 15 = DAS): first repeat
    expect(d.tick(p)).toEqual(['MOVE_L']);
  });

  it('emits ARR repeats after DAS', () => {
    const d = new DasArr({ das: 15, arr: 3 });
    const p = heldSet(['MOVE_R']);
    for (let i = 1; i < 15; i++) d.tick(p);
    expect(d.tick(p)).toEqual(['MOVE_R']); // frame 15 = DAS
    // frames 16, 17 quiet; frame 18 = DAS + 3 → repeat
    expect(d.tick(p)).toEqual([]);
    expect(d.tick(p)).toEqual([]);
    expect(d.tick(p)).toEqual(['MOVE_R']);
    expect(d.tick(p)).toEqual([]);
    expect(d.tick(p)).toEqual([]);
    expect(d.tick(p)).toEqual(['MOVE_R']);
  });

  it('resets on direction change', () => {
    const d = new DasArr({ das: 15, arr: 3 });
    const l = heldSet(['MOVE_L']);
    const r = heldSet(['MOVE_R']);
    for (let i = 1; i <= 14; i++) d.tick(l);
    // Release and press right mid-DAS → counter restarts
    d.tick(heldSet([]));
    expect(d.tick(r)).toEqual([]); // holdFrames becomes 1
    for (let i = 2; i <= 14; i++) d.tick(r);
    expect(d.tick(r)).toEqual(['MOVE_R']);
  });

  it('prioritises MOVE_L when both are held simultaneously', () => {
    const d = new DasArr({ das: 2, arr: 2 });
    const both = heldSet(['MOVE_L', 'MOVE_R']);
    expect(d.tick(both)).toEqual([]); // holdFrames=1
    expect(d.tick(both)).toEqual(['MOVE_L']);
  });

  it('emits nothing once the direction is released', () => {
    const d = new DasArr({ das: 2, arr: 2 });
    const l = heldSet(['MOVE_L']);
    d.tick(l);
    d.tick(l); // holdFrames=2 → emit
    expect(d.tick(heldSet([]))).toEqual([]);
    expect(d.tick(heldSet([]))).toEqual([]);
  });

  it('honours custom DAS / ARR timing', () => {
    const d = new DasArr({ das: 5, arr: 1 });
    const l = heldSet(['MOVE_L']);
    for (let i = 1; i < 5; i++) expect(d.tick(l)).toEqual([]);
    expect(d.tick(l)).toEqual(['MOVE_L']); // frame 5
    expect(d.tick(l)).toEqual(['MOVE_L']); // frame 6 (arr=1)
    expect(d.tick(l)).toEqual(['MOVE_L']); // frame 7
  });

  it('setTiming updates das and arr independently', () => {
    const d = new DasArr({ das: 15, arr: 3 });
    d.setTiming({ das: 10 });
    const l = heldSet(['MOVE_L']);
    for (let i = 1; i < 10; i++) expect(d.tick(l)).toEqual([]);
    expect(d.tick(l)).toEqual(['MOVE_L']); // now DAS=10
  });

  it('reset clears holding state', () => {
    const d = new DasArr({ das: 5, arr: 1 });
    const l = heldSet(['MOVE_L']);
    for (let i = 1; i < 5; i++) d.tick(l);
    d.reset();
    // After reset, the same pressed input starts a new count.
    expect(d.tick(l)).toEqual([]); // holdFrames = 1
  });
});
