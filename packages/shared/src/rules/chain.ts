/**
 * Chain resolver.
 *
 * Repeatedly finds popping clusters, removes them (along with any
 * adjacent ojama), applies gravity, and records one `ChainEvent` per
 * iteration. See D1 §7.1 and §12.2.
 *
 * The function mutates the passed board. Clone upfront if the caller
 * wants to preserve the original state.
 */

import { BOARD_WIDTH, type Board, type Cell, VISIBLE_HEIGHT, isOjama, setCell } from './board';
import { type Cluster, findPoppingClusters } from './cluster';
import { applyGravity } from './gravity';

export interface ChainEvent {
  /** 1-based chain index for the event. */
  chainIndex: number;
  /** Normal-color clusters that popped this tick. */
  clusters: readonly Cluster[];
  /** Number of ojama cells swept up as collateral this tick. */
  ojamaClearedCount: number;
}

export interface ChainResult {
  /** Total number of chain ticks that popped at least one cluster. */
  chainCount: number;
  events: readonly ChainEvent[];
}

/**
 * Resolve chain reactions on the given board in place.
 *
 * Guarantees:
 *   - The board is settled (gravity-compacted) on return.
 *   - `chainCount` equals `events.length`.
 *   - Ojama cells that are outside the visible area (y >= 12) are
 *     never included in `ojamaClearedCount` — they are not adjacent
 *     to popping cells by construction, since pops only occur inside
 *     the visible area.
 */
export function resolveChain(board: Board): ChainResult {
  const events: ChainEvent[] = [];

  while (true) {
    const popping = findPoppingClusters(board);
    if (popping.length === 0) break;

    const chainIndex = events.length + 1;
    const ojamaCleared = sweepOjamaAdjacentTo(board, popping);
    clearClusterCells(board, popping);
    applyGravity(board);

    events.push({
      chainIndex,
      clusters: popping,
      ojamaClearedCount: ojamaCleared,
    });
  }

  return { chainCount: events.length, events };
}

/** Set every cell in every popping cluster to empty. */
function clearClusterCells(board: Board, clusters: readonly Cluster[]): void {
  for (const cluster of clusters) {
    for (const { x, y } of cluster.cells) {
      setCell(board, x, y, null);
    }
  }
}

/**
 * Remove ojama cells that are 4-adjacent to at least one popping cell.
 * Returns how many ojama were removed. Only cells inside the visible
 * area are considered — ojama at y >= 12 cannot be adjacent to a
 * popping cluster (pops stay in the visible area).
 */
function sweepOjamaAdjacentTo(board: Board, clusters: readonly Cluster[]): number {
  const toClear = new Set<number>();
  for (const cluster of clusters) {
    for (const cell of cluster.cells) {
      const candidates: [number, number][] = [
        [cell.x + 1, cell.y],
        [cell.x - 1, cell.y],
        [cell.x, cell.y + 1],
        [cell.x, cell.y - 1],
      ];
      for (const [nx, ny] of candidates) {
        if (nx < 0 || nx >= BOARD_WIDTH) continue;
        if (ny < 0 || ny >= VISIBLE_HEIGHT) continue;
        const row = board.cells[ny] as Cell[];
        const nCell = row[nx] as Cell;
        if (isOjama(nCell.kind)) {
          toClear.add(ny * BOARD_WIDTH + nx);
        }
      }
    }
  }

  for (const key of toClear) {
    const y = Math.floor(key / BOARD_WIDTH);
    const x = key % BOARD_WIDTH;
    setCell(board, x, y, null);
  }
  return toClear.size;
}
