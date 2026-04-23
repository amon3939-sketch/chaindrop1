import { describe, expect, it } from 'vitest';
import { createBoard, getCell, parseBoard, setCell } from './board';
import { resolveChain } from './chain';

describe('resolveChain (D1 §12.2)', () => {
  it('T2-01 clears a single 4-in-a-row in one chain and leaves no clusters', () => {
    const board = parseBoard('RRRR..');
    const result = resolveChain(board);
    expect(result.chainCount).toBe(1);
    expect(result.events[0]!.clusters).toHaveLength(1);
    expect(result.events[0]!.clusters[0]!.size).toBe(4);
    for (let x = 0; x < 6; x++) {
      expect(getCell(board, x, 0)?.kind).toBeNull();
    }
  });

  it('T2-02 two-step chain — gravity after pop 1 creates the 4th B', () => {
    // Initial state (parseBoard reads first line as the topmost row):
    //   y=4  BB....        B at (0,4), (1,4)     — isolated pair
    //   y=3  ......
    //   y=2  .B....        B at (1,2)            — connected to (1,1)
    //   y=1  .BR...        B at (1,1), R at (2,1)
    //   y=0  RRR...        R at (0,0), (1,0), (2,0)
    //
    // Before chain 1:
    //   - R cluster = {(0,0),(1,0),(2,0),(2,1)}  size 4 → pops
    //   - B clusters = {(0,4),(1,4)} size 2 AND {(1,1),(1,2)} size 2 → do not pop
    //
    // After R pops + gravity:
    //   - col 0: B falls from y=4 to y=0.
    //   - col 1: B stack compacts to (1,0),(1,1),(1,2).
    //   - col 2: empties.
    //
    // Chain 2:
    //   - B cluster = {(0,0),(1,0),(1,1),(1,2)} size 4 → pops.
    const board = parseBoard(`
      BB....
      ......
      .B....
      .BR...
      RRR...
    `);
    const result = resolveChain(board);
    expect(result.chainCount).toBe(2);
    expect(result.events[0]!.clusters[0]!.color).toBe('R');
    expect(result.events[1]!.clusters[0]!.color).toBe('B');
    // Board is empty afterwards.
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 6; x++) {
        expect(getCell(board, x, y)?.kind).toBeNull();
      }
    }
  });

  it('T2-03 two different 4-clusters that complete simultaneously count as one chain', () => {
    const board = parseBoard(`
      RRRRBB
      ....BB
    `);
    const result = resolveChain(board);
    expect(result.chainCount).toBe(1);
    expect(result.events[0]!.clusters).toHaveLength(2);
    const colors = result.events[0]!.clusters.map((c) => c.color).sort();
    expect(colors).toEqual(['B', 'R']);
  });

  it('T2-05 adjacent ojama is swept up but does not extend the chain', () => {
    // XX sandwiched between the popping Rs.
    const board = parseBoard(`
      .RRRR.
      .XX...
    `);
    const result = resolveChain(board);
    expect(result.chainCount).toBe(1);
    expect(result.events[0]!.ojamaClearedCount).toBe(2);
    // Ojama not adjacent to a popped cell (none here) would remain.
    // Here both Xs are adjacent to a popped R, so the field is empty.
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 6; x++) {
        expect(getCell(board, x, y)?.kind).toBeNull();
      }
    }
  });

  it('does nothing when there is no popping cluster', () => {
    const board = parseBoard(`
      RRR...
      GGG...
    `);
    const result = resolveChain(board);
    expect(result.chainCount).toBe(0);
    expect(result.events).toHaveLength(0);
    // Board unchanged
    expect(getCell(board, 0, 1)?.kind).toBe('R');
    expect(getCell(board, 0, 0)?.kind).toBe('G');
  });

  it('ojama in the hidden row is never swept up', () => {
    const board = parseBoard('RRRR..');
    setCell(board, 0, 12, 'X'); // hidden row
    const result = resolveChain(board);
    expect(result.chainCount).toBe(1);
    expect(result.events[0]!.ojamaClearedCount).toBe(0);
    // The hidden ojama now sits at y=0 after gravity because the row
    // below it became empty.
    expect(getCell(board, 0, 0)?.kind).toBe('X');
  });

  it('popping clusters of size 5 and 11 are both handled', () => {
    const five = parseBoard(`
      .R....
      RRRR..
    `);
    const r5 = resolveChain(five);
    expect(r5.chainCount).toBe(1);
    expect(r5.events[0]!.clusters[0]!.size).toBe(5);

    const eleven = parseBoard(`
      RRRRR.
      RRRRR.
      R.....
    `);
    const r11 = resolveChain(eleven);
    expect(r11.chainCount).toBe(1);
    expect(r11.events[0]!.clusters[0]!.size).toBe(11);
  });

  it('board remains gravity-settled after the chain completes', () => {
    const board = parseBoard(`
      .RRRR.
      .Y....
    `);
    resolveChain(board);
    // Y should have fallen to y=0 after the reds above cleared
    expect(getCell(board, 1, 0)?.kind).toBe('Y');
    expect(getCell(board, 1, 1)?.kind).toBeNull();
  });

  it('chain indices are contiguous and 1-based', () => {
    // Same trigger chain pattern as T2-02.
    const board = parseBoard(`
      BB....
      ......
      .B....
      .BR...
      RRR...
    `);
    const result = resolveChain(board);
    const indices = result.events.map((e) => e.chainIndex);
    expect(indices).toEqual([1, 2]);
  });
});

describe('resolveChain determinism', () => {
  it('produces identical results for identical inputs', () => {
    const makeBoard = () =>
      parseBoard(`
        RRRRBB
        ....BB
      `);
    const a = makeBoard();
    const b = makeBoard();
    const r1 = resolveChain(a);
    const r2 = resolveChain(b);
    expect(r1.chainCount).toBe(r2.chainCount);
    // Compare event shapes via structural equality
    expect(JSON.stringify(r1.events)).toBe(JSON.stringify(r2.events));
  });
});

describe('resolveChain ignores clusters of size <= 3', () => {
  it('a 3-cluster is not popped', () => {
    const board = createBoard();
    setCell(board, 0, 0, 'R');
    setCell(board, 1, 0, 'R');
    setCell(board, 2, 0, 'R');
    const result = resolveChain(board);
    expect(result.chainCount).toBe(0);
    expect(getCell(board, 0, 0)?.kind).toBe('R');
  });
});
