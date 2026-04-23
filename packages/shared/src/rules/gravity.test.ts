import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, createBoard, getCell, hashBoard, parseBoard, setCell } from './board';
import { applyGravity, hasFloatingCells } from './gravity';

describe('applyGravity', () => {
  it('T3-01 compacts gaps downward within a column', () => {
    // parseBoard reads first line as the TOP row.
    // After parsing: (1,3)=R, (1,2)=null, (1,1)=R, (1,0)=R → one gap at y=2.
    const board = parseBoard(`
      .R....
      ......
      .R....
      .R....
    `);
    expect(getCell(board, 1, 3)?.kind).toBe('R');
    expect(getCell(board, 1, 2)?.kind).toBeNull();
    expect(getCell(board, 1, 1)?.kind).toBe('R');
    expect(getCell(board, 1, 0)?.kind).toBe('R');

    const changed = applyGravity(board);
    expect(changed).toBe(true);

    // Three Rs compacted to the bottom, y=3 becomes empty.
    expect(getCell(board, 1, 0)?.kind).toBe('R');
    expect(getCell(board, 1, 1)?.kind).toBe('R');
    expect(getCell(board, 1, 2)?.kind).toBe('R');
    expect(getCell(board, 1, 3)?.kind).toBeNull();
  });

  it('T3-03 makes no change on a fully-settled board', () => {
    const board = parseBoard(`
      ......
      ......
      .R....
      .RR...
    `);
    const before = hashBoard(board);
    const changed = applyGravity(board);
    expect(changed).toBe(false);
    expect(hashBoard(board)).toBe(before);
  });

  it('T3-02 makes axis and child fall independently (split drop)', () => {
    // Axis at (0, 5), child at (1, 5), both with empty columns below.
    const board = createBoard();
    setCell(board, 0, 5, 'R');
    setCell(board, 1, 5, 'G');
    applyGravity(board);
    expect(getCell(board, 0, 0)?.kind).toBe('R');
    expect(getCell(board, 0, 5)?.kind).toBeNull();
    expect(getCell(board, 1, 0)?.kind).toBe('G');
    expect(getCell(board, 1, 5)?.kind).toBeNull();
  });

  it('handles cells in the hidden row and overflow buffer', () => {
    const board = createBoard();
    setCell(board, 2, 13, 'X'); // overflow buffer
    setCell(board, 2, 12, 'X'); // hidden row
    applyGravity(board);
    expect(getCell(board, 2, 0)?.kind).toBe('X');
    expect(getCell(board, 2, 1)?.kind).toBe('X');
    expect(getCell(board, 2, 13)?.kind).toBeNull();
  });

  it('preserves vertical order within a column', () => {
    // Bottom to top: G, null, R, null, B
    const board = createBoard();
    setCell(board, 3, 0, 'G');
    setCell(board, 3, 2, 'R');
    setCell(board, 3, 4, 'B');
    applyGravity(board);
    expect(getCell(board, 3, 0)?.kind).toBe('G');
    expect(getCell(board, 3, 1)?.kind).toBe('R');
    expect(getCell(board, 3, 2)?.kind).toBe('B');
    expect(getCell(board, 3, 3)?.kind).toBeNull();
  });

  it('does not mix columns — each falls independently', () => {
    const board = createBoard();
    setCell(board, 0, 5, 'R');
    setCell(board, 2, 7, 'G');
    applyGravity(board);
    expect(getCell(board, 0, 0)?.kind).toBe('R');
    expect(getCell(board, 2, 0)?.kind).toBe('G');
    expect(getCell(board, 1, 0)?.kind).toBeNull();
  });

  it('is idempotent', () => {
    const board = parseBoard(`
      ......
      .R....
      ......
      .R....
    `);
    applyGravity(board);
    const onceHash = hashBoard(board);
    const changedAgain = applyGravity(board);
    expect(changedAgain).toBe(false);
    expect(hashBoard(board)).toBe(onceHash);
  });
});

describe('hasFloatingCells', () => {
  it('returns false on a settled board', () => {
    const board = parseBoard(`
      ......
      .R....
      .RR...
    `);
    expect(hasFloatingCells(board)).toBe(false);
  });

  it('returns true when an empty cell has a non-empty cell above it', () => {
    const board = parseBoard(`
      .R....
      ......
      .R....
    `);
    expect(hasFloatingCells(board)).toBe(true);
  });

  it('returns true for single floating cells in high rows', () => {
    const board = createBoard();
    setCell(board, 4, BOARD_HEIGHT - 1, 'R');
    expect(hasFloatingCells(board)).toBe(true);
  });

  it('returns false on an empty board', () => {
    const board = createBoard();
    expect(hasFloatingCells(board)).toBe(false);
  });
});
