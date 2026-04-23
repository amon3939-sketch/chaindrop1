import {
  SPAWN_CHILD_X,
  SPAWN_CHILD_Y,
  advanceFrame,
  createMatchState,
  setCell,
} from '@chaindrop/shared';
import { describe, expect, it } from 'vitest';
import { computeFieldSprites } from './fieldView';
import { FIELD_COLS, PUYO_COLORS, VISIBLE_ROWS, cellCenter } from './layout';

describe('computeFieldSprites', () => {
  it('returns no sprites for an empty board with no active piece', () => {
    const match = createMatchState({ seed: 1, colorMode: 4, players: [{ id: 'A' }] });
    const sprites = computeFieldSprites(match.players[0]!);
    expect(sprites).toEqual([]);
  });

  it('emits one sprite per visible non-empty cell', () => {
    const match = createMatchState({ seed: 1, colorMode: 4, players: [{ id: 'A' }] });
    const p = match.players[0]!;
    setCell(p.board, 0, 0, 'R');
    setCell(p.board, 1, 0, 'G');
    setCell(p.board, 2, 3, 'B');
    const sprites = computeFieldSprites(p);
    expect(sprites).toHaveLength(3);
    const kinds = sprites.map((s) => s.cellKind).sort();
    expect(kinds).toEqual(['B', 'G', 'R']);
  });

  it('never emits sprites for the hidden row (y=12) or overflow buffer (y=13)', () => {
    const match = createMatchState({ seed: 1, colorMode: 4, players: [{ id: 'A' }] });
    const p = match.players[0]!;
    setCell(p.board, 0, 12, 'R'); // hidden
    setCell(p.board, 1, 13, 'X'); // overflow buffer
    const sprites = computeFieldSprites(p);
    expect(sprites).toEqual([]);
  });

  it('places sprites at cellCenter coordinates', () => {
    const match = createMatchState({ seed: 1, colorMode: 4, players: [{ id: 'A' }] });
    const p = match.players[0]!;
    setCell(p.board, 3, 7, 'Y');
    const [sprite] = computeFieldSprites(p);
    const expected = cellCenter(3, 7);
    expect(sprite?.x).toBe(expected.x);
    expect(sprite?.y).toBe(expected.y);
    expect(sprite?.color).toBe(PUYO_COLORS.Y);
  });

  it('includes both axis and child sprites for the active piece', () => {
    const match = createMatchState({ seed: 1, colorMode: 4, players: [{ id: 'A' }] });
    // Drive one frame so the simulator spawns a piece.
    advanceFrame(match);
    const p = match.players[0]!;
    const sprites = computeFieldSprites(p);
    const ids = sprites.map((s) => s.id);
    expect(ids).toContain('piece:axis');
    expect(ids).toContain('piece:child');

    // Axis is placed at the spawn axis position (hidden row, y=12);
    // child sits at y=11 directly below it. The renderer never draws
    // anything above the visible rows, but axis happens to fall inside
    // the hidden row — we still emit it here; the FieldRenderer layer
    // may clip it visually (left to the integration layer).
    const axis = sprites.find((s) => s.id === 'piece:axis')!;
    const child = sprites.find((s) => s.id === 'piece:child')!;
    expect(axis.x).toBe(cellCenter(SPAWN_CHILD_X, SPAWN_CHILD_Y + 1).x);
    expect(child.x).toBe(cellCenter(SPAWN_CHILD_X, SPAWN_CHILD_Y).x);
  });

  it('each sprite id is unique (safe for renderer diffing)', () => {
    const match = createMatchState({ seed: 1, colorMode: 4, players: [{ id: 'A' }] });
    const p = match.players[0]!;
    for (let x = 0; x < FIELD_COLS; x++) {
      for (let y = 0; y < VISIBLE_ROWS; y++) {
        setCell(p.board, x, y, 'R');
      }
    }
    const sprites = computeFieldSprites(p);
    const ids = new Set(sprites.map((s) => s.id));
    expect(ids.size).toBe(sprites.length);
  });

  it('renders ojama with its specific palette color', () => {
    const match = createMatchState({ seed: 1, colorMode: 4, players: [{ id: 'A' }] });
    const p = match.players[0]!;
    setCell(p.board, 0, 0, 'X');
    const [sprite] = computeFieldSprites(p);
    expect(sprite?.color).toBe(PUYO_COLORS.X);
    expect(sprite?.cellKind).toBe('X');
  });

  it('accepts an alpha parameter without error (reserved)', () => {
    const match = createMatchState({ seed: 1, colorMode: 4, players: [{ id: 'A' }] });
    const p = match.players[0]!;
    setCell(p.board, 0, 0, 'R');
    expect(() => computeFieldSprites(p, 0.5)).not.toThrow();
  });
});
