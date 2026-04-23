import { describe, expect, it } from 'vitest';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BUFFER_ROW,
  HIDDEN_ROW,
  VISIBLE_HEIGHT,
  cloneBoard,
  createBoard,
  getCell,
  hashBoard,
  inBounds,
  inVisibleArea,
  isEmpty,
  isNormalColor,
  isOjama,
  parseBoard,
  setCell,
} from './board';

describe('board constants', () => {
  it('matches D1 spec dimensions', () => {
    expect(BOARD_WIDTH).toBe(6);
    expect(BOARD_HEIGHT).toBe(14);
    expect(VISIBLE_HEIGHT).toBe(12);
    expect(HIDDEN_ROW).toBe(12);
    expect(BUFFER_ROW).toBe(13);
  });
});

describe('cell kind predicates', () => {
  it('isNormalColor detects the five normal colors', () => {
    expect(isNormalColor('R')).toBe(true);
    expect(isNormalColor('G')).toBe(true);
    expect(isNormalColor('B')).toBe(true);
    expect(isNormalColor('Y')).toBe(true);
    expect(isNormalColor('P')).toBe(true);
    expect(isNormalColor('X')).toBe(false);
    expect(isNormalColor(null)).toBe(false);
  });

  it('isOjama and isEmpty are mutually exclusive with normal colors', () => {
    expect(isOjama('X')).toBe(true);
    expect(isOjama(null)).toBe(false);
    expect(isOjama('R')).toBe(false);
    expect(isEmpty(null)).toBe(true);
    expect(isEmpty('X')).toBe(false);
    expect(isEmpty('R')).toBe(false);
  });
});

describe('bounds helpers', () => {
  it('inBounds covers the full logical board', () => {
    expect(inBounds(0, 0)).toBe(true);
    expect(inBounds(5, 13)).toBe(true);
    expect(inBounds(-1, 0)).toBe(false);
    expect(inBounds(0, -1)).toBe(false);
    expect(inBounds(6, 0)).toBe(false);
    expect(inBounds(0, 14)).toBe(false);
  });

  it('inVisibleArea excludes y=12 and y=13', () => {
    expect(inVisibleArea(0, 0)).toBe(true);
    expect(inVisibleArea(5, 11)).toBe(true);
    expect(inVisibleArea(0, 12)).toBe(false);
    expect(inVisibleArea(0, 13)).toBe(false);
  });
});

describe('createBoard', () => {
  it('produces an empty 6x14 grid', () => {
    const b = createBoard();
    expect(b.width).toBe(6);
    expect(b.height).toBe(14);
    expect(b.cells).toHaveLength(14);
    for (const row of b.cells) {
      expect(row).toHaveLength(6);
      for (const cell of row) expect(cell.kind).toBeNull();
    }
  });
});

describe('getCell and setCell', () => {
  it('sets and retrieves values', () => {
    const b = createBoard();
    setCell(b, 2, 5, 'R');
    setCell(b, 3, 0, 'X');
    expect(getCell(b, 2, 5)?.kind).toBe('R');
    expect(getCell(b, 3, 0)?.kind).toBe('X');
    expect(getCell(b, 0, 0)?.kind).toBeNull();
  });

  it('getCell returns null out of bounds', () => {
    const b = createBoard();
    expect(getCell(b, -1, 0)).toBeNull();
    expect(getCell(b, 6, 0)).toBeNull();
    expect(getCell(b, 0, -1)).toBeNull();
    expect(getCell(b, 0, 14)).toBeNull();
  });

  it('setCell throws out of bounds', () => {
    const b = createBoard();
    expect(() => setCell(b, -1, 0, 'R')).toThrow();
    expect(() => setCell(b, 0, 14, 'R')).toThrow();
  });
});

describe('cloneBoard', () => {
  it('produces an independent copy', () => {
    const a = createBoard();
    setCell(a, 1, 1, 'R');
    const b = cloneBoard(a);
    expect(getCell(b, 1, 1)?.kind).toBe('R');

    // Mutating the clone does not affect the original
    setCell(b, 1, 1, 'G');
    expect(getCell(a, 1, 1)?.kind).toBe('R');
    expect(getCell(b, 1, 1)?.kind).toBe('G');
  });

  it('clones do not share cell object references', () => {
    const a = createBoard();
    const b = cloneBoard(a);
    const cellA = getCell(a, 0, 0);
    const cellB = getCell(b, 0, 0);
    expect(cellA).not.toBe(cellB);
  });
});

describe('hashBoard', () => {
  it('is stable for identical boards', () => {
    const a = createBoard();
    const b = createBoard();
    setCell(a, 0, 0, 'R');
    setCell(b, 0, 0, 'R');
    expect(hashBoard(a)).toBe(hashBoard(b));
  });

  it('differs when any cell differs', () => {
    const a = createBoard();
    const b = createBoard();
    setCell(a, 0, 0, 'R');
    setCell(b, 0, 0, 'G');
    expect(hashBoard(a)).not.toBe(hashBoard(b));
  });

  it('differs when cell position differs', () => {
    const a = createBoard();
    const b = createBoard();
    setCell(a, 0, 0, 'R');
    setCell(b, 1, 0, 'R');
    expect(hashBoard(a)).not.toBe(hashBoard(b));
  });

  it('treats ojama distinctly from normal colors', () => {
    const a = createBoard();
    const b = createBoard();
    setCell(a, 2, 3, 'X');
    setCell(b, 2, 3, 'R');
    expect(hashBoard(a)).not.toBe(hashBoard(b));
  });

  it('returns a 32-bit unsigned integer', () => {
    const b = createBoard();
    setCell(b, 2, 3, 'R');
    const h = hashBoard(b);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('parseBoard', () => {
  it('places cells with the bottom-row-last convention', () => {
    const b = parseBoard(`
      ......
      ......
      .R....
      .R....
      .RR...
    `);
    // Bottom row was written last, so y=0 holds '.RR...'
    expect(getCell(b, 1, 0)?.kind).toBe('R');
    expect(getCell(b, 2, 0)?.kind).toBe('R');
    expect(getCell(b, 0, 0)?.kind).toBeNull();
    expect(getCell(b, 1, 1)?.kind).toBe('R');
    expect(getCell(b, 1, 2)?.kind).toBe('R');
    expect(getCell(b, 0, 4)?.kind).toBeNull();
  });

  it('handles ojama and all colors', () => {
    const b = parseBoard('RGBYPX');
    expect(getCell(b, 0, 0)?.kind).toBe('R');
    expect(getCell(b, 1, 0)?.kind).toBe('G');
    expect(getCell(b, 2, 0)?.kind).toBe('B');
    expect(getCell(b, 3, 0)?.kind).toBe('Y');
    expect(getCell(b, 4, 0)?.kind).toBe('P');
    expect(getCell(b, 5, 0)?.kind).toBe('X');
  });

  it('rejects unknown characters', () => {
    expect(() => parseBoard('Q.....')).toThrow();
  });

  it('rejects lines wider than the board', () => {
    expect(() => parseBoard('.......')).toThrow();
  });
});
