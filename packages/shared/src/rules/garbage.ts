/**
 * Ojama (garbage) handling: score → garbage conversion, offset,
 * target selection, and column placement.
 *
 * Covers:
 *   - D3 §6: score → garbage conversion at rate 70 with carryover
 *   - D3 §7: offset + target selection tiebreakers
 *   - D3 §8: icon breakdown for the predict bar
 *   - D1 §10: placement with overflow redistribution into y=13 buffer
 *
 * All functions are deterministic given the same inputs (including the
 * RNG state). No global state.
 */

import { BOARD_HEIGHT, BOARD_WIDTH, type Board, type Cell, setCell } from './board';
import type { Xorshift32 } from './rng';

// ---------- Score → Garbage conversion (D3 §6) ----------

/** Default conversion rate: `garbage = floor(score / 70)`. */
export const GARBAGE_RATE = 70;

export interface GarbageConversion {
  /** How many ojama this tick generated. */
  generated: number;
  /** Score remainder to carry over into the next conversion. */
  newLeftover: number;
}

/**
 * Convert score to ojama count with carryover.
 *
 *   accumulated = leftover + score
 *   generated   = floor(accumulated / rate)
 *   newLeftover = accumulated mod rate
 */
export function convertScoreToGarbage(
  currentLeftover: number,
  score: number,
  rate: number = GARBAGE_RATE,
): GarbageConversion {
  if (rate <= 0 || !Number.isFinite(rate)) {
    throw new RangeError(`convertScoreToGarbage: rate must be positive, got ${rate}`);
  }
  const accumulated = currentLeftover + score;
  const generated = Math.floor(accumulated / rate);
  const newLeftover = accumulated - generated * rate;
  return { generated, newLeftover };
}

// ---------- Offset (D3 §7.1) ----------

export interface OffsetResult {
  /** How many ojama were canceled by this tick. */
  offset: number;
  /** Pending garbage after cancellation. */
  remainingPending: number;
  /** Generated ojama left to send to an opponent. */
  remainingGenerated: number;
}

/**
 * Cancel `min(pending, generated)` units of ojama.
 * Returns both remainders so the caller can update state directly.
 */
export function applyOffset(pendingGarbage: number, generated: number): OffsetResult {
  const offset = Math.min(pendingGarbage, generated);
  return {
    offset,
    remainingPending: pendingGarbage - offset,
    remainingGenerated: generated - offset,
  };
}

// ---------- Target selection (D3 §7.2) ----------

export type PlayerStatus = 'playing' | 'dead' | 'spectating';

export interface TargetablePlayer {
  readonly id: string;
  readonly slotIndex: number;
  readonly score: number;
  readonly pendingGarbage: number;
  readonly status: PlayerStatus;
}

/**
 * Choose a deterministic target among all players that are still
 * `playing`, excluding self. Tiebreakers (per D3 §7.2):
 *   1. least pendingGarbage
 *   2. least score
 *   3. least slotIndex (room join order)
 *
 * Returns `null` if no eligible opponent exists.
 */
export function selectTarget<T extends TargetablePlayer>(self: T, players: readonly T[]): T | null {
  const candidates: T[] = [];
  for (const p of players) {
    if (p.id === self.id) continue;
    if (p.status !== 'playing') continue;
    candidates.push(p);
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.pendingGarbage !== b.pendingGarbage) return a.pendingGarbage - b.pendingGarbage;
    if (a.score !== b.score) return a.score - b.score;
    return a.slotIndex - b.slotIndex;
  });
  return candidates[0] as T;
}

// ---------- Predict-bar icon breakdown (D3 §8) ----------

export type OjamaIconKind = 'small' | 'large' | 'rock' | 'star' | 'moon' | 'crown' | 'comet';

interface OjamaUnit {
  readonly kind: OjamaIconKind;
  readonly value: number;
}

/** Icon sizes, largest first — used for greedy decomposition. */
export const OJAMA_UNITS: readonly OjamaUnit[] = [
  { kind: 'comet', value: 1440 },
  { kind: 'crown', value: 720 },
  { kind: 'moon', value: 360 },
  { kind: 'star', value: 180 },
  { kind: 'rock', value: 30 },
  { kind: 'large', value: 6 },
  { kind: 'small', value: 1 },
];

/**
 * Decompose an ojama count into a sequence of predict-bar icons,
 * largest first. Non-negative integer input is expected.
 */
export function countToIcons(count: number): OjamaIconKind[] {
  if (count < 0 || !Number.isInteger(count)) {
    throw new RangeError(`countToIcons: expected non-negative integer, got ${count}`);
  }
  const result: OjamaIconKind[] = [];
  let remaining = count;
  for (const unit of OJAMA_UNITS) {
    while (remaining >= unit.value) {
      result.push(unit.kind);
      remaining -= unit.value;
    }
  }
  return result;
}

// ---------- Placement on the board (D1 §10) ----------

/** Maximum number of ojama dropped in a single wave (6 columns × 5 rows). */
export const MAX_OJAMA_PER_WAVE = 30;

export interface OjamaPlacementResult {
  /** How many ojama were successfully written to the board. */
  dropped: number;
  /**
   * How many were destroyed because every column was full at and
   * above y=13. Usually 0 unless the field is nearly topped out.
   */
  destroyed: number;
  /** How many units of the `count` could not fit into this wave. */
  carryOver: number;
}

/**
 * Drop up to `MAX_OJAMA_PER_WAVE` ojama onto the board.
 *
 * Algorithm (D1 §10.2):
 *   - Even rows (floor(count/6)) are spread across all 6 columns.
 *   - The extras (count % 6) pick that many distinct columns at
 *     random (via the provided RNG, so placement is deterministic).
 *   - When a column is full through the overflow buffer, excess
 *     ojama for that column are redistributed to other columns
 *     that still have room.
 *   - Anything that cannot fit even after redistribution is destroyed.
 *
 * Mutates `board` in place. `rng` is advanced.
 */
export function placeOjama(board: Board, count: number, rng: Xorshift32): OjamaPlacementResult {
  if (count < 0 || !Number.isInteger(count)) {
    throw new RangeError(`placeOjama: expected non-negative integer, got ${count}`);
  }

  const dropCount = Math.min(count, MAX_OJAMA_PER_WAVE);
  const carryOver = count - dropCount;

  if (dropCount === 0) {
    return { dropped: 0, destroyed: 0, carryOver };
  }

  const fullRows = Math.floor(dropCount / BOARD_WIDTH);
  const extras = dropCount - fullRows * BOARD_WIDTH;

  const placements = new Array<number>(BOARD_WIDTH).fill(fullRows);
  if (extras > 0) {
    const selectedCols = rng.sampleIndices(BOARD_WIDTH, extras);
    for (const col of selectedCols) {
      placements[col] = (placements[col] as number) + 1;
    }
  }

  let totalPlaced = 0;
  for (let x = 0; x < BOARD_WIDTH; x++) {
    const want = placements[x] as number;
    totalPlaced += placeInColumn(board, x, want, rng);
  }

  return {
    dropped: totalPlaced,
    destroyed: dropCount - totalPlaced,
    carryOver,
  };
}

/** Lowest empty y in column `x`, or -1 if the column is completely full. */
function lowestEmptyY(board: Board, x: number): number {
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    const row = board.cells[y] as Cell[];
    const cell = row[x] as Cell;
    if (cell.kind === null) return y;
  }
  return -1;
}

function placeInColumn(board: Board, x: number, n: number, rng: Xorshift32): number {
  let placed = 0;
  for (let i = 0; i < n; i++) {
    const y = lowestEmptyY(board, x);
    if (y >= 0) {
      setCell(board, x, y, 'X');
      placed++;
    } else {
      placed += redistributeFrom(board, x, 1, rng);
    }
  }
  return placed;
}

function redistributeFrom(board: Board, excludeColumn: number, n: number, rng: Xorshift32): number {
  let placed = 0;
  for (let i = 0; i < n; i++) {
    const candidates: number[] = [];
    for (let x = 0; x < BOARD_WIDTH; x++) {
      if (x === excludeColumn) continue;
      if (lowestEmptyY(board, x) >= 0) candidates.push(x);
    }
    if (candidates.length === 0) return placed;
    const idx = rng.nextInt(candidates.length);
    const targetX = candidates[idx] as number;
    const targetY = lowestEmptyY(board, targetX);
    // By construction targetY >= 0 here.
    setCell(board, targetX, targetY, 'X');
    placed++;
  }
  return placed;
}
