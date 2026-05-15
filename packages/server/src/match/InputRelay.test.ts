import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputRelay } from './InputRelay';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('InputRelay', () => {
  it('emits an INPUT_BATCH as soon as every player has submitted for that frame', () => {
    const batches: Array<{ frame: number; inputs: Record<string, string[]> }> = [];
    const relay = new InputRelay({
      playerOrder: ['A', 'B'],
      onBatchReady: (frame, inputs) => batches.push({ frame, inputs }),
      onPlayerTimeout: () => {
        throw new Error('unexpected timeout');
      },
    });

    relay.submit('A', 0, ['MOVE_L']);
    expect(batches).toEqual([]);
    relay.submit('B', 0, ['ROT_R']);
    expect(batches).toEqual([{ frame: 0, inputs: { A: ['MOVE_L'], B: ['ROT_R'] } }]);
  });

  it('force-flushes a frame after the timeout and fills missing players with empty input', () => {
    const batches: Array<{ frame: number; inputs: Record<string, string[]> }> = [];
    const relay = new InputRelay({
      playerOrder: ['A', 'B'],
      flushTimeoutMs: 200,
      onBatchReady: (frame, inputs) => batches.push({ frame, inputs }),
      onPlayerTimeout: () => {},
    });

    relay.submit('A', 5, ['MOVE_R']);
    vi.advanceTimersByTime(199);
    expect(batches).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(batches).toEqual([{ frame: 5, inputs: { A: ['MOVE_R'], B: [] } }]);
  });

  it('ignores submissions for frames that have already flushed', () => {
    const batches: Array<{ frame: number; inputs: Record<string, string[]> }> = [];
    const relay = new InputRelay({
      playerOrder: ['A', 'B'],
      onBatchReady: (frame, inputs) => batches.push({ frame, inputs }),
      onPlayerTimeout: () => {},
    });

    relay.submit('A', 0, []);
    relay.submit('B', 0, []);
    // Late arrival — A already flushed, B's stale write must be dropped.
    relay.submit('A', 0, ['MOVE_L']);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.inputs.A).toEqual([]);
  });

  it('signals a player timeout after the configured miss streak', () => {
    const timeouts: string[] = [];
    const relay = new InputRelay({
      playerOrder: ['A', 'B'],
      flushTimeoutMs: 10,
      missThreshold: 3,
      onBatchReady: () => {},
      onPlayerTimeout: (pid) => timeouts.push(pid),
    });

    // A misses three consecutive frames — B always submits in time.
    for (let f = 0; f < 3; f++) {
      relay.submit('B', f, []);
      vi.advanceTimersByTime(10);
    }
    expect(timeouts).toEqual(['A']);
  });

  it('disposes the pending timers so no further batches fire after dispose()', () => {
    const batches: Array<{ frame: number }> = [];
    const relay = new InputRelay({
      playerOrder: ['A', 'B'],
      flushTimeoutMs: 50,
      onBatchReady: (frame) => batches.push({ frame }),
      onPlayerTimeout: () => {},
    });

    relay.submit('A', 0, []);
    relay.dispose();
    vi.advanceTimersByTime(100);
    expect(batches).toEqual([]);
  });
});
