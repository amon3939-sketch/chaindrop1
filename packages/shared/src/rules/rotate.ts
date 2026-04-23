/**
 * Piece movement and rotation with wall kick + quickturn.
 *
 * Wall-kick rule (D1 §4.2):
 *   When a straight rotation is blocked, shift the axis in the
 *   direction opposite the child's NEW position, then retry.
 *
 *   e.g. CW 0→1 (child moves LEFT of axis) → kick axis one step RIGHT.
 *
 * Quickturn rule (D1 §4.3):
 *   When rotation is 0 or 2 and both (axis.x-1, axis.y) and
 *   (axis.x+1, axis.y) are blocked (walls or occupied), a rotation
 *   request immediately flips the rotation 180° (0 ↔ 2) as a single
 *   move, even if the straight rotation would have failed.
 *
 * All functions here are pure: they return a NEW piece on success
 * and never mutate the input or the board.
 */

import { BOARD_HEIGHT, BOARD_WIDTH, type Board, type Cell } from './board';
import {
  type Piece,
  type Rotation,
  childOffset,
  getChildPos,
  rotateCCW,
  rotateCW,
  withPiece,
} from './piece';

/** A cell is blocked when it is out of bounds OR not empty. */
function isBlocked(board: Board, x: number, y: number): boolean {
  if (x < 0 || x >= BOARD_WIDTH) return true;
  if (y < 0 || y >= BOARD_HEIGHT) return true;
  const row = board.cells[y] as Cell[];
  const cell = row[x] as Cell;
  return cell.kind !== null;
}

/** True when the piece (both axis and child) fits on the board. */
export function canPlacePiece(board: Board, piece: Piece): boolean {
  if (isBlocked(board, piece.axisX, piece.axisY)) return false;
  const [cx, cy] = getChildPos(piece);
  if (isBlocked(board, cx, cy)) return false;
  return true;
}

/**
 * Translate the piece by (dx, dy). Returns the new piece if the
 * destination fits, or `null` if blocked.
 */
export function tryMove(board: Board, piece: Piece, dx: number, dy: number): Piece | null {
  const next = withPiece(piece, {
    axisX: piece.axisX + dx,
    axisY: piece.axisY + dy,
  });
  return canPlacePiece(board, next) ? next : null;
}

export type RotationDirection = 'CW' | 'CCW';

/**
 * Rotate the piece CW (X button) or CCW (Z button) by 90°.
 *
 * Returns the new piece after applying the first successful strategy:
 *   1. straight rotation
 *   2. wall kick (axis shifted opposite the child's new side)
 *   3. quickturn (180° flip when both lateral sides are blocked,
 *      and the current rotation is vertical: 0 or 2)
 *
 * Returns `null` if none of the strategies fit.
 */
export function tryRotate(board: Board, piece: Piece, direction: RotationDirection): Piece | null {
  const nextRotation = direction === 'CW' ? rotateCW(piece.rotation) : rotateCCW(piece.rotation);

  // 1. Straight rotation.
  const straight = withPiece(piece, { rotation: nextRotation });
  if (canPlacePiece(board, straight)) return straight;

  // 2. Wall kick: push axis in the opposite direction of the child's new side.
  const [childDx, childDy] = childOffset(nextRotation);
  const kicked = withPiece(piece, {
    axisX: piece.axisX - childDx,
    axisY: piece.axisY - childDy,
    rotation: nextRotation,
  });
  if (canPlacePiece(board, kicked)) return kicked;

  // 3. Quickturn — only when starting from a vertical rotation (0 or 2)
  //    AND both lateral sides of the axis are blocked.
  if ((piece.rotation === 0 || piece.rotation === 2) && bothLateralSidesBlocked(board, piece)) {
    const flipped: Rotation = ((piece.rotation + 2) & 3) as Rotation;
    const quick = withPiece(piece, { rotation: flipped });
    if (canPlacePiece(board, quick)) return quick;
  }

  return null;
}

function bothLateralSidesBlocked(board: Board, piece: Piece): boolean {
  return (
    isBlocked(board, piece.axisX - 1, piece.axisY) && isBlocked(board, piece.axisX + 1, piece.axisY)
  );
}
