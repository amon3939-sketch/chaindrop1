import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, BOARD_WIDTH, createBoard, getCell, setCell } from './board';
import {
  GARBAGE_RATE,
  MAX_OJAMA_PER_WAVE,
  type OjamaIconKind,
  type TargetablePlayer,
  applyOffset,
  convertScoreToGarbage,
  countToIcons,
  placeOjama,
  selectTarget,
} from './garbage';
import { Xorshift32 } from './rng';

// ---------- Score → Garbage (D3 §13.3, tests TG-01..TG-04) ----------

describe('convertScoreToGarbage (D3 §6)', () => {
  it('TG-01 leftover=0, score=40 → generated=0, newLeftover=40', () => {
    expect(convertScoreToGarbage(0, 40)).toEqual({ generated: 0, newLeftover: 40 });
  });
  it('TG-02 leftover=40, score=320 → generated=5, newLeftover=10', () => {
    expect(convertScoreToGarbage(40, 320)).toEqual({ generated: 5, newLeftover: 10 });
  });
  it('TG-03 leftover=69, score=1 → generated=1, newLeftover=0', () => {
    expect(convertScoreToGarbage(69, 1)).toEqual({ generated: 1, newLeftover: 0 });
  });
  it('TG-04 leftover=0, score=140 → generated=2, newLeftover=0', () => {
    expect(convertScoreToGarbage(0, 140)).toEqual({ generated: 2, newLeftover: 0 });
  });

  it('uses default rate of 70', () => {
    expect(GARBAGE_RATE).toBe(70);
  });

  it('honors a custom rate', () => {
    expect(convertScoreToGarbage(0, 100, 50)).toEqual({ generated: 2, newLeftover: 0 });
  });

  it('rejects non-positive rates', () => {
    expect(() => convertScoreToGarbage(0, 100, 0)).toThrow();
    expect(() => convertScoreToGarbage(0, 100, -70)).toThrow();
  });
});

// ---------- Offset (D3 §13.4, tests TO-01..TO-04) ----------

describe('applyOffset (D3 §7.1)', () => {
  it('TO-01 pending=20, generated=15 → pending=5, send=0', () => {
    expect(applyOffset(20, 15)).toEqual({
      offset: 15,
      remainingPending: 5,
      remainingGenerated: 0,
    });
  });
  it('TO-02 pending=10, generated=69 → pending=0, send=59', () => {
    expect(applyOffset(10, 69)).toEqual({
      offset: 10,
      remainingPending: 0,
      remainingGenerated: 59,
    });
  });
  it('TO-03 pending=0, generated=10 → pending=0, send=10', () => {
    expect(applyOffset(0, 10)).toEqual({
      offset: 0,
      remainingPending: 0,
      remainingGenerated: 10,
    });
  });
  it('TO-04 pending=50, generated=0 → pending=50, send=0', () => {
    expect(applyOffset(50, 0)).toEqual({
      offset: 0,
      remainingPending: 50,
      remainingGenerated: 0,
    });
  });
});

// ---------- Target selection (D3 §13.5, tests TT-01..TT-04) ----------

function mkPlayer(
  id: string,
  slotIndex: number,
  pendingGarbage: number,
  score: number,
  status: TargetablePlayer['status'] = 'playing',
): TargetablePlayer {
  return { id, slotIndex, pendingGarbage, score, status };
}

describe('selectTarget (D3 §7.2)', () => {
  const self = mkPlayer('A', 0, 5, 1000);

  it('TT-01 picks the opponent with the least pending', () => {
    const target = selectTarget(self, [self, mkPlayer('B', 1, 5, 1000), mkPlayer('C', 2, 10, 500)]);
    expect(target?.id).toBe('B');
  });

  it('TT-02 tiebreaks on pending by lower score', () => {
    const target = selectTarget(self, [self, mkPlayer('B', 1, 10, 500), mkPlayer('C', 2, 10, 200)]);
    expect(target?.id).toBe('C');
  });

  it('TT-03 tiebreaks on (pending, score) by slotIndex', () => {
    const target = selectTarget(self, [self, mkPlayer('B', 1, 10, 500), mkPlayer('C', 2, 10, 500)]);
    expect(target?.id).toBe('B');
  });

  it('TT-04 returns null when nobody is still playing', () => {
    const target = selectTarget(self, [
      self,
      mkPlayer('B', 1, 0, 0, 'dead'),
      mkPlayer('C', 2, 0, 0, 'spectating'),
    ]);
    expect(target).toBeNull();
  });

  it('excludes self even if self has the lowest pending', () => {
    const target = selectTarget(mkPlayer('A', 0, 0, 0), [
      mkPlayer('A', 0, 0, 0),
      mkPlayer('B', 1, 10, 500),
    ]);
    expect(target?.id).toBe('B');
  });

  it('does not mutate the input list', () => {
    const original: TargetablePlayer[] = [
      self,
      mkPlayer('C', 2, 10, 500),
      mkPlayer('B', 1, 10, 500),
    ];
    const snapshot = original.map((p) => p.id);
    selectTarget(self, original);
    expect(original.map((p) => p.id)).toEqual(snapshot);
  });
});

// ---------- Icon breakdown (D3 §13.6, tests TD-01..TD-04) ----------

describe('countToIcons (D3 §8)', () => {
  it('TD-01 count=1 → [small]', () => {
    expect(countToIcons(1)).toEqual<OjamaIconKind[]>(['small']);
  });
  it('TD-02 count=6 → [large]', () => {
    expect(countToIcons(6)).toEqual<OjamaIconKind[]>(['large']);
  });
  it('TD-03 count=50 → rock + 3×large + 2×small', () => {
    expect(countToIcons(50)).toEqual<OjamaIconKind[]>([
      'rock',
      'large',
      'large',
      'large',
      'small',
      'small',
    ]);
  });
  it('TD-04 count=1500 → comet + 2×rock', () => {
    expect(countToIcons(1500)).toEqual<OjamaIconKind[]>(['comet', 'rock', 'rock']);
  });
  it('count=0 → []', () => {
    expect(countToIcons(0)).toEqual([]);
  });
  it('count=1440 → [comet]', () => {
    expect(countToIcons(1440)).toEqual<OjamaIconKind[]>(['comet']);
  });
  it('rejects negative or non-integer counts', () => {
    expect(() => countToIcons(-1)).toThrow();
    expect(() => countToIcons(1.5)).toThrow();
  });
});

// ---------- Placement on the board (D1 §12.6, tests T6-01..T6-07) ----------

describe('placeOjama (D1 §10)', () => {
  it('T6-01 count=6 places one in each column', () => {
    const board = createBoard();
    const rng = new Xorshift32(1);
    const result = placeOjama(board, 6, rng);
    expect(result).toEqual({ dropped: 6, destroyed: 0, carryOver: 0 });
    for (let x = 0; x < BOARD_WIDTH; x++) {
      expect(getCell(board, x, 0)?.kind).toBe('X');
      expect(getCell(board, x, 1)?.kind).toBeNull();
    }
  });

  it('T6-02 count=30 fills every column with five ojama each', () => {
    const board = createBoard();
    const rng = new Xorshift32(2);
    const result = placeOjama(board, 30, rng);
    expect(result).toEqual({ dropped: 30, destroyed: 0, carryOver: 0 });
    for (let x = 0; x < BOARD_WIDTH; x++) {
      for (let y = 0; y < 5; y++) {
        expect(getCell(board, x, y)?.kind).toBe('X');
      }
      expect(getCell(board, x, 5)?.kind).toBeNull();
    }
  });

  it('T6-03 count=35 drops 30 and carries over 5', () => {
    const board = createBoard();
    const rng = new Xorshift32(3);
    const result = placeOjama(board, 35, rng);
    expect(result).toEqual({ dropped: 30, destroyed: 0, carryOver: 5 });
  });

  it('T6-04 identical seed places ojama in the same columns', () => {
    const a = createBoard();
    const b = createBoard();
    placeOjama(a, 3, new Xorshift32(42));
    placeOjama(b, 3, new Xorshift32(42));
    for (let x = 0; x < BOARD_WIDTH; x++) {
      expect(getCell(a, x, 0)?.kind).toBe(getCell(b, x, 0)?.kind);
    }
  });

  it('T6-05 redistributes to another column when the target column is full', () => {
    const board = createBoard();
    // Fill column 0 all the way through the overflow buffer.
    for (let y = 0; y < BOARD_HEIGHT; y++) setCell(board, 0, y, 'X');
    const rng = new Xorshift32(7);
    // Ask for a tiny wave (count=1) that would choose a single extras column.
    // Even if it happened to pick column 0, redistribution must kick in.
    const result = placeOjama(board, 1, rng);
    expect(result.dropped).toBe(1);
    expect(result.destroyed).toBe(0);
    // Column 0 is unchanged (still X from y=0..BOARD_HEIGHT-1), the extra
    // ojama lives somewhere else.
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      expect(getCell(board, 0, y)?.kind).toBe('X');
    }
    // Find at least one other column whose y=0 was the target.
    let foundElsewhere = false;
    for (let x = 1; x < BOARD_WIDTH; x++) {
      if (getCell(board, x, 0)?.kind === 'X') foundElsewhere = true;
    }
    expect(foundElsewhere).toBe(true);
  });

  it('T6-06 destroys the excess when every column is full', () => {
    const board = createBoard();
    for (let x = 0; x < BOARD_WIDTH; x++) {
      for (let y = 0; y < BOARD_HEIGHT; y++) setCell(board, x, y, 'X');
    }
    const rng = new Xorshift32(11);
    const result = placeOjama(board, 6, rng);
    expect(result).toEqual({ dropped: 0, destroyed: 6, carryOver: 0 });
  });

  it('T6-07 existing ojama in y=13 still lets new ones land in y<=11 when space opens', () => {
    // This is a thin test: we put an ojama at y=13 of column 0, then
    // drop 1 ojama. It should land at y=0 in some column (might be 0
    // itself if that column still has capacity below — which it does
    // here because y=0..12 are empty).
    const board = createBoard();
    setCell(board, 0, 13, 'X');
    const rng = new Xorshift32(13);
    const result = placeOjama(board, 1, rng);
    expect(result.dropped).toBe(1);
    // The existing y=13 ojama is undisturbed.
    expect(getCell(board, 0, 13)?.kind).toBe('X');
  });

  it('MAX_OJAMA_PER_WAVE is 30', () => {
    expect(MAX_OJAMA_PER_WAVE).toBe(30);
  });

  it('count=0 is a no-op', () => {
    const board = createBoard();
    const rng = new Xorshift32(99);
    const result = placeOjama(board, 0, rng);
    expect(result).toEqual({ dropped: 0, destroyed: 0, carryOver: 0 });
  });

  it('advances the RNG state', () => {
    const rng = new Xorshift32(1);
    const s0 = rng.getState();
    placeOjama(createBoard(), 3, rng);
    expect(rng.getState()).not.toBe(s0);
  });
});

describe('placeOjama determinism across independent boards', () => {
  it('same seed + same count → same final board state', () => {
    const a = createBoard();
    const b = createBoard();
    placeOjama(a, 17, new Xorshift32(1234));
    placeOjama(b, 17, new Xorshift32(1234));
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        expect(getCell(a, x, y)?.kind).toBe(getCell(b, x, y)?.kind);
      }
    }
  });
});
