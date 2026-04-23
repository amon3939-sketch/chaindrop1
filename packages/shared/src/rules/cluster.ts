/**
 * BFS-based cluster detection for the playing field.
 *
 * A "cluster" is a 4-connected component of cells that share the same
 * normal color. Ojama cells never form clusters (they are not a color
 * in the connectivity sense).
 *
 * The search is restricted to the visible area y ∈ [0, 11]. Cells in
 * the hidden row (y=12) and overflow buffer (y=13) are never part of
 * any cluster — see D1 §7.2.
 *
 * `findClusters` returns every connected component, regardless of
 * size. Callers (e.g. the chain resolver) filter by `size >= 4`.
 */

import type { PuyoColor } from '../protocol/types';
import { BOARD_WIDTH, type Board, type Cell, VISIBLE_HEIGHT, isNormalColor } from './board';

export interface ClusterCell {
  x: number;
  y: number;
}

export interface Cluster {
  color: PuyoColor;
  size: number;
  cells: readonly ClusterCell[];
}

export function findClusters(board: Board): Cluster[] {
  const visited: boolean[][] = [];
  for (let y = 0; y < VISIBLE_HEIGHT; y++) {
    const row: boolean[] = new Array(BOARD_WIDTH).fill(false);
    visited.push(row);
  }

  const clusters: Cluster[] = [];

  for (let y = 0; y < VISIBLE_HEIGHT; y++) {
    const visitedRow = visited[y] as boolean[];
    for (let x = 0; x < BOARD_WIDTH; x++) {
      if (visitedRow[x]) continue;
      visitedRow[x] = true;

      const cellRow = board.cells[y] as Cell[];
      const cell = cellRow[x] as Cell;
      if (!isNormalColor(cell.kind)) continue;

      const color: PuyoColor = cell.kind;
      const cells: ClusterCell[] = [{ x, y }];
      const queue: [number, number][] = [[x, y]];

      while (queue.length > 0) {
        const head = queue.shift() as [number, number];
        const cx = head[0];
        const cy = head[1];

        // 4-connected neighbors. Order is fixed for determinism.
        const neighbors: [number, number][] = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= BOARD_WIDTH) continue;
          if (ny < 0 || ny >= VISIBLE_HEIGHT) continue;
          const nVisited = visited[ny] as boolean[];
          if (nVisited[nx]) continue;
          const nCellRow = board.cells[ny] as Cell[];
          const nCell = nCellRow[nx] as Cell;
          if (nCell.kind !== color) continue;
          nVisited[nx] = true;
          cells.push({ x: nx, y: ny });
          queue.push([nx, ny]);
        }
      }

      clusters.push({ color, size: cells.length, cells });
    }
  }

  return clusters;
}

/** Convenience: only clusters whose size qualifies them to pop. */
export const MIN_POP_SIZE = 4;

export function findPoppingClusters(board: Board): Cluster[] {
  return findClusters(board).filter((c) => c.size >= MIN_POP_SIZE);
}
