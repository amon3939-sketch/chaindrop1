import { describe, expect, it } from 'vitest';
import { createBoard, parseBoard, setCell } from './board';
import { MIN_POP_SIZE, findClusters, findPoppingClusters } from './cluster';

describe('findClusters (D1 §12.1)', () => {
  it('T1-01 horizontal 4-in-a-row forms one cluster of size 4', () => {
    const board = parseBoard('RRRR..');
    const clusters = findClusters(board);
    expect(clusters).toHaveLength(1);
    const c = clusters[0]!;
    expect(c.color).toBe('R');
    expect(c.size).toBe(4);
  });

  it('T1-02 vertical 4-in-a-column forms one cluster of size 4', () => {
    const board = parseBoard(`
      .R....
      .R....
      .R....
      .R....
    `);
    const clusters = findClusters(board);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.size).toBe(4);
  });

  it('T1-03 L-shape forms one cluster of size 4', () => {
    const board = parseBoard(`
      .R....
      .R....
      .RR...
    `);
    const clusters = findClusters(board);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.size).toBe(4);
  });

  it('T1-04 3-in-a-row is a cluster of size 3 (below pop threshold)', () => {
    const board = parseBoard('RRR...');
    const clusters = findClusters(board);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.size).toBe(3);
    expect(findPoppingClusters(board)).toEqual([]);
  });

  it('T1-05 mixed colors each under 4 produce multiple small clusters', () => {
    const board = parseBoard(`
      RRRGGG
      BBYYPP
    `);
    const clusters = findClusters(board);
    // Two horizontal rows, 5 clusters: 3R, 3G, 2B, 2Y, 2P.
    const sizes = clusters.map((c) => c.size).sort((a, b) => a - b);
    expect(sizes).toEqual([2, 2, 2, 3, 3]);
    expect(findPoppingClusters(board)).toEqual([]);
  });

  it('T1-06 five adjacent form one cluster of size 5', () => {
    const board = parseBoard(`
      .R....
      RRRR..
    `);
    const clusters = findClusters(board);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.size).toBe(5);
  });

  it('T1-07 diagonal-only neighbors do not connect', () => {
    const board = parseBoard(`
      R.....
      .R....
      ..R...
      ...R..
    `);
    const clusters = findClusters(board);
    expect(clusters).toHaveLength(4);
    for (const c of clusters) expect(c.size).toBe(1);
  });

  it('T1-08 a cluster of 4 in the hidden row (y=12) is not detected', () => {
    const board = createBoard();
    setCell(board, 0, 12, 'R');
    setCell(board, 1, 12, 'R');
    setCell(board, 2, 12, 'R');
    setCell(board, 3, 12, 'R');
    expect(findClusters(board)).toEqual([]);
  });

  it('T1-09 visible + hidden row cells do not merge into a 4-cluster', () => {
    // Three visible + one hidden
    const board = createBoard();
    setCell(board, 0, 11, 'R');
    setCell(board, 1, 11, 'R');
    setCell(board, 2, 11, 'R');
    setCell(board, 2, 12, 'R'); // in hidden row
    const popping = findPoppingClusters(board);
    expect(popping).toEqual([]);
    // Visible-side cluster alone is size 3
    const visibleSizes = findClusters(board).map((c) => c.size);
    expect(visibleSizes).toEqual([3]);
  });

  it('T1-10 four adjacent ojama do not form a cluster', () => {
    const board = parseBoard('XXXX..');
    expect(findClusters(board)).toEqual([]);
  });

  it('T1-11 cells in the overflow buffer (y=13) are never clustered', () => {
    const board = createBoard();
    setCell(board, 0, 13, 'R');
    setCell(board, 1, 13, 'R');
    setCell(board, 2, 13, 'R');
    setCell(board, 3, 13, 'R');
    expect(findClusters(board)).toEqual([]);
  });

  it('returns cells in a deterministic order across runs', () => {
    const board = parseBoard(`
      RRRR..
    `);
    const a = findClusters(board)[0]!;
    const b = findClusters(board)[0]!;
    expect(a.cells).toEqual(b.cells);
  });

  it('empty board produces no clusters', () => {
    expect(findClusters(createBoard())).toEqual([]);
  });
});

describe('findPoppingClusters', () => {
  it('filters by the pop threshold', () => {
    const board = parseBoard(`
      RRR...
      BBBB..
    `);
    const popping = findPoppingClusters(board);
    expect(popping).toHaveLength(1);
    expect(popping[0]!.color).toBe('B');
    expect(popping[0]!.size).toBeGreaterThanOrEqual(MIN_POP_SIZE);
  });
});
