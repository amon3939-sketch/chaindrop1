import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, type Board, createBoard, setCell } from './board';
import { type Piece, createPiece } from './piece';
import { canPlacePiece, tryMove, tryRotate } from './rotate';

/** Helper: piece whose axis sits at (x, y) with the given rotation. */
function pieceAt(x: number, y: number, rotation: Piece['rotation'] = 0): Piece {
  return { axisX: x, axisY: y, rotation, colors: ['R', 'G'] };
}

describe('canPlacePiece', () => {
  it('accepts the spawn position on an empty board', () => {
    const board = createBoard();
    const p = createPiece(['R', 'G']);
    expect(canPlacePiece(board, p)).toBe(true);
  });

  it('rejects when the axis cell is occupied', () => {
    const board = createBoard();
    setCell(board, 2, 12, 'X');
    expect(canPlacePiece(board, pieceAt(2, 12))).toBe(false);
  });

  it('rejects when the child cell is occupied', () => {
    const board = createBoard();
    setCell(board, 2, 11, 'X');
    expect(canPlacePiece(board, pieceAt(2, 12))).toBe(false);
  });

  it('rejects when the child goes out of bounds (y=-1)', () => {
    const board = createBoard();
    expect(canPlacePiece(board, pieceAt(2, 0, 0))).toBe(false);
  });

  it('rejects when the axis goes out of the left wall', () => {
    const board = createBoard();
    expect(canPlacePiece(board, pieceAt(-1, 5, 0))).toBe(false);
  });

  it('rejects when rotation=2 child escapes the top buffer', () => {
    const board = createBoard();
    // axis at y=13 with rotation 2 → child at y=14, out of bounds
    expect(canPlacePiece(board, pieceAt(2, 13, 2))).toBe(false);
  });
});

describe('tryMove', () => {
  it('moves left on an empty board', () => {
    const board = createBoard();
    const p = pieceAt(2, 6);
    const moved = tryMove(board, p, -1, 0);
    expect(moved).not.toBeNull();
    expect(moved?.axisX).toBe(1);
    expect(moved?.axisY).toBe(6);
  });

  it('is blocked by the left wall', () => {
    const board = createBoard();
    const p = pieceAt(0, 6);
    expect(tryMove(board, p, -1, 0)).toBeNull();
  });

  it('is blocked by an occupied cell', () => {
    const board = createBoard();
    setCell(board, 1, 6, 'X');
    const p = pieceAt(2, 6);
    expect(tryMove(board, p, -1, 0)).toBeNull();
  });

  it('moves down (soft drop) until the floor', () => {
    const board = createBoard();
    // rotation=0 puts child BELOW axis. axis at y=1 → child at y=0.
    // Moving down once would put child at y=-1 which is blocked.
    const p = pieceAt(2, 1, 0);
    expect(tryMove(board, p, 0, -1)).toBeNull();
  });

  it('does not mutate the input piece or the board', () => {
    const board = createBoard();
    const originalHash = JSON.stringify(board.cells);
    const p = pieceAt(2, 6);
    const snapshot = { ...p };
    tryMove(board, p, 1, 0);
    expect(p).toEqual(snapshot);
    expect(JSON.stringify(board.cells)).toBe(originalHash);
  });
});

describe('tryRotate — straight rotation (D1 §12.4 T4-01)', () => {
  it('T4-01 CW at mid-board succeeds and changes rotation', () => {
    const board = createBoard();
    const p = pieceAt(2, 6, 0);
    const rotated = tryRotate(board, p, 'CW');
    expect(rotated?.rotation).toBe(1);
  });

  it('CCW at mid-board succeeds and changes rotation', () => {
    const board = createBoard();
    const p = pieceAt(2, 6, 0);
    const rotated = tryRotate(board, p, 'CCW');
    expect(rotated?.rotation).toBe(3);
  });
});

describe('tryRotate — wall kick (D1 §12.4 T4-02, T4-03)', () => {
  it('T4-02 at right wall, CCW (rotation 0 → 3, child goes right) kicks axis left', () => {
    // axis at x=5 (right wall), rotation 0. CCW → rotation 3, child would be at x=6 (out of bounds).
    // Wall kick: axis gets pushed -1x → axis at x=4, child at x=5.
    const board = createBoard();
    const p = pieceAt(5, 6, 0);
    const rotated = tryRotate(board, p, 'CCW');
    expect(rotated).not.toBeNull();
    expect(rotated?.rotation).toBe(3);
    expect(rotated?.axisX).toBe(4);
  });

  it('T4-03 at left wall, CW (rotation 0 → 1, child goes left) kicks axis right', () => {
    // axis at x=0 (left wall), rotation 0. CW → rotation 1, child would be at x=-1 (OOB).
    // Wall kick: axis pushed +1x → axis at x=1, child at x=0.
    const board = createBoard();
    const p = pieceAt(0, 6, 0);
    const rotated = tryRotate(board, p, 'CW');
    expect(rotated).not.toBeNull();
    expect(rotated?.rotation).toBe(1);
    expect(rotated?.axisX).toBe(1);
  });

  it('when neighboring column is occupied, wall kick still works against empty cells', () => {
    // axis at x=1. CW → rotation 1, child at x=0. If x=0 at the same y is empty, no kick needed.
    // Instead, put a blocker at (0, y), forcing a kick.
    const board = createBoard();
    setCell(board, 0, 6, 'X');
    const p = pieceAt(1, 6, 0);
    const rotated = tryRotate(board, p, 'CW');
    // Child position (0, 6) is blocked → try kick: axis shifted to +1x → (2, 6). Child at (1, 6).
    expect(rotated?.axisX).toBe(2);
    expect(rotated?.rotation).toBe(1);
  });
});

describe('tryRotate — quickturn (D1 §12.4 T4-04)', () => {
  it('T4-04 both lateral sides blocked → 180° flip', () => {
    const board = createBoard();
    // Axis at (2, 6) with rotation 0. Lateral sides: (1, 6) and (3, 6).
    setCell(board, 1, 6, 'X');
    setCell(board, 3, 6, 'X');
    const p = pieceAt(2, 6, 0);
    const rotated = tryRotate(board, p, 'CW');
    expect(rotated?.rotation).toBe(2);
    expect(rotated?.axisX).toBe(2);
  });

  it('does not quickturn when starting from a horizontal rotation (1 or 3)', () => {
    const board = createBoard();
    // Block the straight-rotation destination and the wall-kick destination.
    // This is just a "both fail" case, but quickturn also must not fire.
    // Surround the piece tightly.
    setCell(board, 1, 6, 'X');
    setCell(board, 3, 6, 'X');
    setCell(board, 2, 7, 'X');
    setCell(board, 2, 5, 'X');
    // axis at (2, 6), rotation 1 (child at x=1), same-y both sides blocked.
    // But since rotation is not 0 or 2, quickturn rule does NOT apply.
    const p = pieceAt(2, 6, 1);
    // Child (1,6) is already blocked so the piece wouldn't exist here on a
    // real board, but we only test the rotate logic. tryRotate should see
    // the straight destination blocked, try wall kick which is also blocked,
    // and not fall back to quickturn because rotation != 0 and != 2.
    expect(tryRotate(board, p, 'CW')).toBeNull();
  });
});

describe('tryRotate — T4-05 ground pushes axis up when needed', () => {
  it('piece near the floor with rotation 3 rotating CW to 0 pushes axis up', () => {
    // rotation 3 → child is to the RIGHT of axis. CW to 0 → child BELOW axis (y-1).
    // If axis is at y=0, child after rotation would be at y=-1 (out of bounds).
    // Wall kick: shift axis +1y → axis at y=1, child at y=0.
    const board = createBoard();
    const p = pieceAt(2, 0, 3);
    const rotated = tryRotate(board, p, 'CW');
    expect(rotated?.rotation).toBe(0);
    expect(rotated?.axisY).toBe(1);
  });
});

describe('tryRotate — failure mode', () => {
  it('returns null when every strategy is blocked', () => {
    const board = createBoard();
    // axis at (2, 6), surround every potentially-used cell with ojama.
    // We block:
    //   - child's new position (for CW)
    //   - wall-kick destination
    //   - 180° destination
    //   - the entire row above (to stop quickturn from landing)
    // Simplest way: fill the entire 6x14 board except (2,6).
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < 6; x++) {
        if (x === 2 && y === 6) continue;
        setCell(board, x, y, 'X');
      }
    }
    const p = pieceAt(2, 6, 0);
    expect(tryRotate(board, p, 'CW')).toBeNull();
  });
});

describe('pure function contract', () => {
  it('tryRotate does not mutate the input piece', () => {
    const board = createBoard();
    const p = pieceAt(2, 6, 0);
    const snapshot = { ...p };
    tryRotate(board, p, 'CW');
    expect(p).toEqual(snapshot);
  });

  it('tryRotate does not mutate the board', () => {
    const board = createBoard();
    setCell(board, 0, 0, 'X');
    const before = JSON.stringify(board.cells);
    const p = pieceAt(2, 6, 0);
    tryRotate(board, p, 'CW');
    expect(JSON.stringify(board.cells)).toBe(before);
  });
});

// Suppress the unused-import warning for Board (used implicitly via createBoard)
void ({} as Board);
