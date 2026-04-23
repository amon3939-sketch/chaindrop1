/**
 * Playing field ("Board") types and utilities.
 *
 * Coordinate system (see D1 §1):
 *   - x in [0, 5] (left=0)
 *   - y in [0, 13] (bottom=0)
 *   - y in [0, 11]: visible playing area (12 rows)
 *   - y = 12:      hidden row, excluded from chain detection
 *   - y = 13:      ojama overflow buffer, also excluded from chain detection
 */

import type { PuyoColor } from '../protocol/types';

export const BOARD_WIDTH = 6 as const;
export const BOARD_HEIGHT = 14 as const;
export const VISIBLE_HEIGHT = 12 as const;
export const HIDDEN_ROW = 12 as const;
export const BUFFER_ROW = 13 as const;

/** Values stored in a board cell. `X` = ojama (garbage), null = empty. */
export type CellKind = PuyoColor | 'X' | null;

export interface Cell {
  kind: CellKind;
}

export interface Board {
  readonly width: typeof BOARD_WIDTH;
  readonly height: typeof BOARD_HEIGHT;
  /** cells[y][x] — bottom row is y=0 */
  cells: Cell[][];
}

/** All normal colors supported by the engine. Ojama is not a color. */
export const NORMAL_COLORS: readonly PuyoColor[] = ['R', 'G', 'B', 'Y', 'P'] as const;

export function isNormalColor(kind: CellKind): kind is PuyoColor {
  return kind === 'R' || kind === 'G' || kind === 'B' || kind === 'Y' || kind === 'P';
}

export function isOjama(kind: CellKind): kind is 'X' {
  return kind === 'X';
}

export function isEmpty(kind: CellKind): boolean {
  return kind === null;
}

/** True when (x, y) is inside the logical board (including hidden + buffer). */
export function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT;
}

/** True when (x, y) is inside the visible playing area (y in [0, 11]). */
export function inVisibleArea(x: number, y: number): boolean {
  return x >= 0 && x < BOARD_WIDTH && y >= 0 && y < VISIBLE_HEIGHT;
}

/** Create a new empty board. */
export function createBoard(): Board {
  const cells: Cell[][] = [];
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < BOARD_WIDTH; x++) {
      row.push({ kind: null });
    }
    cells.push(row);
  }
  return {
    width: BOARD_WIDTH,
    height: BOARD_HEIGHT,
    cells,
  };
}

/** Deep copy. Safe to mutate either copy independently. */
export function cloneBoard(board: Board): Board {
  const cells: Cell[][] = [];
  for (let y = 0; y < board.height; y++) {
    const row: Cell[] = [];
    const src = board.cells[y] as Cell[];
    for (let x = 0; x < board.width; x++) {
      row.push({ kind: (src[x] as Cell).kind });
    }
    cells.push(row);
  }
  return {
    width: board.width,
    height: board.height,
    cells,
  };
}

export function getCell(board: Board, x: number, y: number): Cell | null {
  if (!inBounds(x, y)) return null;
  return (board.cells[y] as Cell[])[x] as Cell;
}

export function setCell(board: Board, x: number, y: number, kind: CellKind): void {
  if (!inBounds(x, y)) {
    throw new RangeError(`setCell: (${x}, ${y}) is out of bounds`);
  }
  (board.cells[y] as Cell[])[x] = { kind };
}

/**
 * Deterministic 32-bit hash of the board contents (FNV-1a).
 * Used for desync detection in lockstep (see D4 §6).
 * The hash is independent of object identity; only `kind` values matter.
 */
export function hashBoard(board: Board): number {
  let h = 0x811c9dc5;
  for (let y = 0; y < board.height; y++) {
    const row = board.cells[y] as Cell[];
    for (let x = 0; x < board.width; x++) {
      const k = (row[x] as Cell).kind;
      // Stable per-kind byte codes:
      //   null → 0, 'X' → 1, R/G/B/Y/P → 2..6
      const code =
        k === null
          ? 0
          : k === 'X'
            ? 1
            : k === 'R'
              ? 2
              : k === 'G'
                ? 3
                : k === 'B'
                  ? 4
                  : k === 'Y'
                    ? 5
                    : 6;
      h ^= code;
      // 32-bit FNV prime multiplication, emulated with Math.imul to avoid float drift
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

/**
 * Parse a small ASCII grid, bottom-row last, into a board.
 * Useful for concise test fixtures.
 *
 * Example (5 rows tall, from y=4 down to y=0):
 *   ```
 *   ......
 *   ......
 *   .R....
 *   .R....
 *   .RR...
 *   ```
 * Characters: '.' = empty, 'R'/'G'/'B'/'Y'/'P' = color, 'X' = ojama.
 * Rows outside the provided grid remain empty (default board fill).
 */
export function parseBoard(ascii: string): Board {
  const lines = ascii
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const board = createBoard();
  // First line in the string is the TOP row. Reverse to iterate bottom-up.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[lines.length - 1 - i] as string;
    if (line.length > BOARD_WIDTH) {
      throw new Error(`parseBoard: line too long (${line.length} > ${BOARD_WIDTH}): ${line}`);
    }
    for (let x = 0; x < line.length; x++) {
      const ch = line[x] as string;
      if (ch === '.') continue;
      if (ch === 'X' || ch === 'R' || ch === 'G' || ch === 'B' || ch === 'Y' || ch === 'P') {
        setCell(board, x, i, ch);
      } else {
        throw new Error(`parseBoard: unexpected char '${ch}' at (${x}, ${i})`);
      }
    }
  }
  return board;
}
