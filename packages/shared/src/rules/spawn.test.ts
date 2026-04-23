import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, BOARD_WIDTH, createBoard, setCell } from './board';
import { SPAWN_AXIS_X, SPAWN_AXIS_Y, SPAWN_CHILD_X, SPAWN_CHILD_Y } from './piece';
import { trySpawn } from './spawn';

describe('trySpawn (D1 §9, tests T5-01..T5-04)', () => {
  it('T5-01 child spawn cell occupied → DEATH', () => {
    const board = createBoard();
    setCell(board, SPAWN_CHILD_X, SPAWN_CHILD_Y, 'R');
    expect(trySpawn(board)).toBe('DEATH');
  });

  it('T5-02 axis spawn cell occupied but child spawn empty → OK', () => {
    const board = createBoard();
    setCell(board, SPAWN_AXIS_X, SPAWN_AXIS_Y, 'X');
    expect(trySpawn(board)).toBe('OK');
  });

  it('T5-03 overflow buffer (y=13) holds ojama but child spawn empty → OK', () => {
    const board = createBoard();
    setCell(board, SPAWN_AXIS_X, 13, 'X');
    expect(trySpawn(board)).toBe('OK');
  });

  it('T5-04 every cell occupied except the child spawn → OK', () => {
    const board = createBoard();
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        if (x === SPAWN_CHILD_X && y === SPAWN_CHILD_Y) continue;
        setCell(board, x, y, 'X');
      }
    }
    expect(trySpawn(board)).toBe('OK');
  });

  it('triggers DEATH regardless of the colour occupying the child cell', () => {
    for (const kind of ['R', 'G', 'B', 'Y', 'P', 'X'] as const) {
      const board = createBoard();
      setCell(board, SPAWN_CHILD_X, SPAWN_CHILD_Y, kind);
      expect(trySpawn(board)).toBe('DEATH');
    }
  });

  it('an empty board allows spawn', () => {
    expect(trySpawn(createBoard())).toBe('OK');
  });
});
