/**
 * Spawn check: decides whether a new piece can appear at the spawn
 * position without immediately losing.
 *
 * See D1 §9. The only judgement is made on the CHILD spawn position
 * (x=2, y=11) — the top of the visible area. The axis position
 * (x=2, y=12) lives in the hidden row and may legitimately be
 * occupied by ojama that pushed into the overflow buffer.
 */

import type { Board, Cell } from './board';
import { SPAWN_CHILD_X, SPAWN_CHILD_Y } from './piece';

export type SpawnResult = 'OK' | 'DEATH';

/**
 * Decide whether a fresh piece can appear.
 * Returns 'DEATH' when the child spawn cell is already occupied.
 */
export function trySpawn(board: Board): SpawnResult {
  const row = board.cells[SPAWN_CHILD_Y] as Cell[];
  const cell = row[SPAWN_CHILD_X] as Cell;
  return cell.kind === null ? 'OK' : 'DEATH';
}
