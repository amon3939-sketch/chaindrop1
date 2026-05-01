/**
 * Pure state → sprite transformation.
 *
 * Consumes a `PlayerState` and an interpolation `alpha` ∈ [0, 1) and
 * returns a list of positioned sprites ready for the renderer. Split
 * from `FieldRenderer` so that this file is fully testable without a
 * working Pixi/WebGL context.
 */

import {
  type CellKind,
  POP_FRAMES,
  type PlayerState,
  type PuyoColor,
  VISIBLE_HEIGHT,
  getChildPos,
  isNormalColor,
} from '@chaindrop/shared';
import { FIELD_COLS, cellCenter, colorFor } from './layout';

export type SpriteKind = 'board' | 'axis' | 'child';

export interface SpriteConnections {
  up: boolean;
  right: boolean;
  down: boolean;
  left: boolean;
}

export interface FieldSprite {
  /** Stable identity for renderer diffing ("col:row" or "piece:axis"/"piece:child"). */
  id: string;
  /** What it is (for future styling). */
  kind: SpriteKind;
  /** Solid puyo fill color. */
  color: number;
  /** Cell kind, handy when the renderer differentiates normal vs ojama. */
  cellKind: Exclude<CellKind, null>;
  /** Target pixel center — already interpolated when applicable. */
  x: number;
  y: number;
  /**
   * Which of the four cardinal neighbours share this cell's color.
   * Used by the renderer to draw connector nubs that visually fuse
   * same-color puyos into a single organic blob (original-style).
   * Only normal-color BOARD cells set this — ojama and the active
   * piece sprites do not connect visually in solo play.
   */
  connections?: SpriteConnections;
  /**
   * 0..1 pop-animation progress when this cell is currently in the
   * popping phase of a chain tick. Absent when the sprite is not
   * being popped.
   */
  popProgress?: number;
}

/**
 * Build the sprite list for a single player's field.
 *
 *   - Every non-empty cell inside the VISIBLE area becomes one sprite.
 *   - The active piece (if any) is drawn separately at its current
 *     axis/child coordinates.
 *   - When the player is resolving a chain, cells in the current
 *     popping clusters get a `popProgress` (0..1) so the renderer
 *     can scale / fade them.
 *
 * `alpha` is accepted for API symmetry but not currently used — piece
 * smoothing is handled in the renderer's own animation state.
 */
export function computeFieldSprites(player: PlayerState, alpha = 0): FieldSprite[] {
  void alpha;
  const sprites: FieldSprite[] = [];

  // Lookup: which board cells are mid-pop right now?
  // The pop animation covers the first POP_FRAMES of the resolve tick
  // so that popProgress reaches 1.0 exactly when the simulator clears
  // the cells. After that, the renderer animates the gravity fall.
  const poppingCells = new Set<number>();
  let popProgress = 0;
  if (player.phase === 'resolving' && player.resolvingData && !player.resolvingData.applied) {
    const tick = player.resolvingData.tickFrame;
    popProgress = Math.min(1, tick / POP_FRAMES);
    for (const cluster of player.resolvingData.pendingClusters) {
      for (const c of cluster.cells) {
        poppingCells.add(c.y * FIELD_COLS + c.x);
      }
    }
  }

  // Settled cells
  for (let y = 0; y < VISIBLE_HEIGHT; y++) {
    const row = player.board.cells[y];
    if (!row) continue;
    for (let x = 0; x < FIELD_COLS; x++) {
      const cell = row[x];
      if (!cell) continue;
      const kind = cell.kind;
      if (kind === null) continue;
      const color = colorFor(kind);
      if (color === null) continue;
      const { x: px, y: py } = cellCenter(x, y);
      const sprite: FieldSprite = {
        id: `cell:${x}:${y}`,
        kind: 'board',
        color,
        cellKind: kind,
        x: px,
        y: py,
      };
      if (isNormalColor(kind)) {
        sprite.connections = computeConnections(player, x, y, kind);
      }
      if (poppingCells.has(y * FIELD_COLS + x)) {
        sprite.popProgress = popProgress;
      }
      sprites.push(sprite);
    }
  }

  // Active falling piece
  const piece = player.current;
  if (piece) {
    const axisColor = colorFor(piece.colors[0]);
    const childColor = colorFor(piece.colors[1]);
    if (axisColor !== null) {
      const { x: ax, y: ay } = cellCenter(piece.axisX, piece.axisY);
      sprites.push({
        id: 'piece:axis',
        kind: 'axis',
        color: axisColor,
        cellKind: piece.colors[0],
        x: ax,
        y: ay,
      });
    }
    const [cx, cy] = getChildPos(piece);
    if (childColor !== null) {
      const { x: pxC, y: pyC } = cellCenter(cx, cy);
      sprites.push({
        id: 'piece:child',
        kind: 'child',
        color: childColor,
        cellKind: piece.colors[1],
        x: pxC,
        y: pyC,
      });
    }
  }

  return sprites;
}

/**
 * Inspect the 4-connected neighbours of (x, y) and report which ones
 * share the same normal color. Only cells inside the visible area
 * count — cells in the hidden row or overflow buffer never form a
 * visual bond even if they happen to match colors. The field frame
 * (walls, floor) is NOT treated as fused: bottom-row puyos keep the
 * standard rounded silhouette rather than extending into the floor
 * bar.
 */
function computeConnections(
  player: PlayerState,
  x: number,
  y: number,
  color: PuyoColor,
): SpriteConnections {
  return {
    up: sameColorVisible(player, x, y + 1, color),
    right: sameColorVisible(player, x + 1, y, color),
    down: sameColorVisible(player, x, y - 1, color),
    left: sameColorVisible(player, x - 1, y, color),
  };
}

function sameColorVisible(player: PlayerState, x: number, y: number, color: PuyoColor): boolean {
  if (x < 0 || x >= FIELD_COLS) return false;
  if (y < 0 || y >= VISIBLE_HEIGHT) return false;
  const row = player.board.cells[y];
  if (!row) return false;
  const cell = row[x];
  if (!cell) return false;
  return cell.kind === color;
}
