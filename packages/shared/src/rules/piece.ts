/**
 * Puyo pair ("tsumo") type and geometry utilities.
 *
 * See D1 §3. The axis puyo is the pivot; the child orbits around it.
 * Spawn position is axis=(2, 12), child=(2, 11) with rotation=0
 * (child sits directly below the axis).
 */

import type { PuyoColor } from '../protocol/types';

/**
 * Rotation value.
 *   0 → child is BELOW the axis (spawn orientation)
 *   1 → child is LEFT of the axis
 *   2 → child is ABOVE the axis
 *   3 → child is RIGHT of the axis
 *
 * CW rotation (X button):  0 → 1 → 2 → 3 → 0
 * CCW rotation (Z button): 0 → 3 → 2 → 1 → 0
 */
export type Rotation = 0 | 1 | 2 | 3;

export interface Piece {
  axisX: number;
  axisY: number;
  rotation: Rotation;
  colors: readonly [PuyoColor, PuyoColor];
}

/** Spawn position of the axis puyo. See D1 §1.3. */
export const SPAWN_AXIS_X = 2 as const;
export const SPAWN_AXIS_Y = 12 as const;
/** Spawn position of the child puyo (axis rotation=0). */
export const SPAWN_CHILD_X = 2 as const;
export const SPAWN_CHILD_Y = 11 as const;

/** Offset (dx, dy) from the axis to the child, indexed by rotation. */
export function childOffset(rotation: Rotation): readonly [number, number] {
  switch (rotation) {
    case 0:
      return [0, -1]; // below
    case 1:
      return [-1, 0]; // left
    case 2:
      return [0, 1]; // above
    case 3:
      return [1, 0]; // right
  }
}

/** Absolute position of the child puyo for the given piece. */
export function getChildPos(piece: Piece): readonly [number, number] {
  const [dx, dy] = childOffset(piece.rotation);
  return [piece.axisX + dx, piece.axisY + dy];
}

/**
 * Create a fresh piece at the spawn position with rotation=0.
 * `colors[0]` is the axis color, `colors[1]` is the child color.
 */
export function createPiece(colors: readonly [PuyoColor, PuyoColor]): Piece {
  return {
    axisX: SPAWN_AXIS_X,
    axisY: SPAWN_AXIS_Y,
    rotation: 0,
    colors,
  };
}

/** CW rotation index (0→1→2→3→0). Does not mutate the input. */
export function rotateCW(rotation: Rotation): Rotation {
  return ((rotation + 1) & 3) as Rotation;
}

/** CCW rotation index (0→3→2→1→0). Does not mutate the input. */
export function rotateCCW(rotation: Rotation): Rotation {
  return ((rotation + 3) & 3) as Rotation;
}

/**
 * Shallow copy with arbitrary field overrides. Handy for tests and
 * for producing the "next-piece" state without mutating the current one.
 */
export function withPiece(piece: Piece, patch: Partial<Piece>): Piece {
  return {
    axisX: patch.axisX ?? piece.axisX,
    axisY: patch.axisY ?? piece.axisY,
    rotation: patch.rotation ?? piece.rotation,
    colors: patch.colors ?? piece.colors,
  };
}
