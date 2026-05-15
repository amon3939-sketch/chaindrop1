import { describe, expect, it } from 'vitest';
import { HashChecker } from './HashChecker';

describe('HashChecker', () => {
  it('does nothing while a frame is still partial', () => {
    let calls = 0;
    const c = new HashChecker({
      playerOrder: ['A', 'B'],
      onMismatch: () => calls++,
    });
    c.submit('A', 0, 'h0');
    expect(calls).toBe(0);
  });

  it('stays silent when every player reports the same hash for a frame', () => {
    let calls = 0;
    const c = new HashChecker({
      playerOrder: ['A', 'B'],
      onMismatch: () => calls++,
    });
    c.submit('A', 0, 'same');
    c.submit('B', 0, 'same');
    expect(calls).toBe(0);
  });

  it('fires onMismatch with the offending hashes when they diverge', () => {
    const events: Array<{ frame: number; hashes: Record<string, string> }> = [];
    const c = new HashChecker({
      playerOrder: ['A', 'B'],
      onMismatch: (frame, hashes) => events.push({ frame, hashes }),
    });
    c.submit('A', 42, 'left');
    c.submit('B', 42, 'right');
    expect(events).toEqual([{ frame: 42, hashes: { A: 'left', B: 'right' } }]);
  });

  it('ignores submissions from players outside the announced roster', () => {
    let calls = 0;
    const c = new HashChecker({
      playerOrder: ['A', 'B'],
      onMismatch: () => calls++,
    });
    c.submit('A', 0, 'a');
    c.submit('C', 0, 'c');
    c.submit('B', 0, 'b');
    // Mismatch should fire on the (A, B) pair alone — C never counted.
    expect(calls).toBe(1);
  });
});
