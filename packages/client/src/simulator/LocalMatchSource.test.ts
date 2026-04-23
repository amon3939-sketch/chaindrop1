import { describe, expect, it } from 'vitest';
import { LocalMatchSource } from './LocalMatchSource';

describe('LocalMatchSource', () => {
  it('echoes submitted inputs back on the same frame (zero delay)', () => {
    const src = new LocalMatchSource({ seed: 1, colorMode: 4 });
    src.submitInput(0, ['MOVE_L']);
    const batch = src.getInputBatch(0);
    expect(batch).toEqual({ solo: ['MOVE_L'] });
  });

  it('returns an empty batch if no input was submitted', () => {
    const src = new LocalMatchSource({ seed: 1, colorMode: 4 });
    expect(src.getInputBatch(0)).toEqual({ solo: [] });
  });

  it('exposes the generated match state', () => {
    const src = new LocalMatchSource({ seed: 7, colorMode: 5 });
    expect(src.match.colorMode).toBe(5);
    expect(src.match.players).toHaveLength(1);
    expect(src.match.players[0]?.id).toBe('solo');
  });

  it('respects a custom playerId', () => {
    const src = new LocalMatchSource({ seed: 1, colorMode: 4, playerId: 'alice' });
    expect(src.myPlayerId).toBe('alice');
    src.submitInput(3, ['ROT_R']);
    expect(src.getInputBatch(3)).toEqual({ alice: ['ROT_R'] });
  });

  it('does not fire the end handler while the match is running', () => {
    const src = new LocalMatchSource({ seed: 1, colorMode: 4 });
    let fired = false;
    src.onMatchEnd(() => {
      fired = true;
    });
    src.notifyIfEnded();
    expect(fired).toBe(false);
  });

  it('fires the end handler exactly once when the match finishes', () => {
    const src = new LocalMatchSource({ seed: 1, colorMode: 4 });
    let calls = 0;
    let captured: string | null = 'not-called';
    src.onMatchEnd((winner) => {
      calls++;
      captured = winner;
    });
    // Force the match into 'finished'.
    src.match.status = 'finished';
    src.match.winnerId = null;
    src.notifyIfEnded();
    src.notifyIfEnded();
    expect(calls).toBe(1);
    expect(captured).toBeNull();
  });
});
