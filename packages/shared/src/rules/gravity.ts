/**
 * Column-wise gravity for the playing field.
 *
 * See D1 §5.4 (split drop) and §6.2 (gravity after piece lock).
 * Gravity operates on the full logical board (y = 0..13), including
 * the hidden row and overflow buffer — anything above an empty cell
 * falls, regardless of whether it is a normal color or an ojama.
 */

import { BOARD_HEIGHT, BOARD_WIDTH, type Board, type Cell } from './board';

/**
 * Compact every column so that all non-empty cells sit at the bottom
 * with no gaps between them. Order inside a column is preserved
 * (the bottom-most non-empty cell stays the bottom-most).
 *
 * Mutates `board` in place. Returns `true` if any cell moved.
 */
export function applyGravity(board: Board): boolean {
  return applyGravityWithFall(board).changed;
}

export interface GravityResult {
  changed: boolean;
  /** Largest single-cell fall distance (in board cells) across all columns. */
  maxFall: number;
}

/**
 * Same as `applyGravity`, but also reports the longest distance any
 * single cell fell. The caller uses this to size the visual settle
 * window so chain ticks don't fire while puyos are still mid-air.
 */
export function applyGravityWithFall(board: Board): GravityResult {
  let changed = false;
  let maxFall = 0;
  for (let x = 0; x < BOARD_WIDTH; x++) {
    // Collect non-empty cells (bottom→top) along with their original y.
    const stack: Cell[] = [];
    const sourceY: number[] = [];
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      const row = board.cells[y] as Cell[];
      const cell = row[x] as Cell;
      if (cell.kind !== null) {
        stack.push(cell);
        sourceY.push(y);
      }
    }
    // Write them back, padding the top with empty cells.
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      const row = board.cells[y] as Cell[];
      const current = row[x] as Cell;
      const next = y < stack.length ? (stack[y] as Cell) : { kind: null };
      if (current.kind !== next.kind) changed = true;
      if (y < stack.length) {
        const fall = (sourceY[y] as number) - y;
        if (fall > maxFall) maxFall = fall;
      }
      row[x] = next;
    }
  }
  return { changed, maxFall };
}

/**
 * Returns `true` when at least one column has a non-empty cell that
 * sits directly above an empty cell (i.e. `applyGravity` would move it).
 * Useful for split-drop detection after a piece is locked.
 */
export function hasFloatingCells(board: Board): boolean {
  for (let x = 0; x < BOARD_WIDTH; x++) {
    let seenEmpty = false;
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      const row = board.cells[y] as Cell[];
      const cell = row[x] as Cell;
      if (cell.kind === null) {
        seenEmpty = true;
      } else if (seenEmpty) {
        return true;
      }
    }
  }
  return false;
}
