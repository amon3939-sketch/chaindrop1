/**
 * Pure state → sprite transformation.
 *
 * Consumes a `PlayerState` and an interpolation `alpha` ∈ [0, 1) and
 * returns a list of positioned sprites ready for the renderer. Split
 * from `FieldRenderer` so that this file is fully testable without a
 * working Pixi/WebGL context.
 */

import { type CellKind, type PlayerState, VISIBLE_HEIGHT, getChildPos } from '@chaindrop/shared';
import { FIELD_COLS, cellCenter, colorFor } from './layout';

export type SpriteKind = 'board' | 'axis' | 'child';

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
}

/**
 * Build the sprite list for a single player's field.
 *
 *   - Every non-empty cell inside the VISIBLE area becomes one sprite.
 *   - The active piece (if any) is drawn separately at its current
 *     axis/child coordinates. The simulator advances the piece by
 *     whole cells per frame; `alpha` is accepted for API symmetry
 *     with the renderer's call signature but is not used for piece
 *     movement at this stage (smooth interpolation lands with the
 *     animation pass in a later milestone).
 */
export function computeFieldSprites(player: PlayerState, alpha = 0): FieldSprite[] {
  void alpha; // reserved for later interpolation
  const sprites: FieldSprite[] = [];

  // Settled cells
  for (let y = 0; y < VISIBLE_HEIGHT; y++) {
    for (let x = 0; x < FIELD_COLS; x++) {
      const row = player.board.cells[y];
      if (!row) continue;
      const cell = row[x];
      if (!cell) continue;
      const kind = cell.kind;
      if (kind === null) continue;
      const color = colorFor(kind);
      if (color === null) continue;
      const { x: px, y: py } = cellCenter(x, y);
      sprites.push({
        id: `cell:${x}:${y}`,
        kind: 'board',
        color,
        cellKind: kind,
        x: px,
        y: py,
      });
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
