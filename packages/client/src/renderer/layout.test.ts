import { describe, expect, it } from 'vitest';
import {
  CELL_SIZE,
  FIELD_COLS,
  FIELD_ORIGIN_X,
  FIELD_ORIGIN_Y,
  FIELD_PIXEL_HEIGHT,
  FIELD_PIXEL_WIDTH,
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  PUYO_COLORS,
  VISIBLE_ROWS,
  cellCenter,
  colorFor,
} from './layout';

describe('layout constants', () => {
  it('matches the internal 1280x720 design surface', () => {
    expect(INTERNAL_WIDTH).toBe(1280);
    expect(INTERNAL_HEIGHT).toBe(720);
  });

  it('derives field dimensions from cell size and column/row counts', () => {
    expect(FIELD_PIXEL_WIDTH).toBe(CELL_SIZE * FIELD_COLS);
    expect(FIELD_PIXEL_HEIGHT).toBe(CELL_SIZE * VISIBLE_ROWS);
    expect(FIELD_COLS).toBe(6);
    expect(VISIBLE_ROWS).toBe(12);
  });

  it('fits the field within the internal drawing surface', () => {
    expect(FIELD_ORIGIN_X + FIELD_PIXEL_WIDTH).toBeLessThanOrEqual(INTERNAL_WIDTH);
    expect(FIELD_ORIGIN_Y + FIELD_PIXEL_HEIGHT).toBeLessThanOrEqual(INTERNAL_HEIGHT);
  });

  it('defines distinct colors for all 5 puyos plus ojama', () => {
    const seen = new Set(Object.values(PUYO_COLORS));
    expect(seen.size).toBe(6);
  });
});

describe('cellCenter', () => {
  it('places board (0, 0) at the bottom-left cell center of the field', () => {
    const { x, y } = cellCenter(0, 0);
    expect(x).toBe(FIELD_ORIGIN_X + CELL_SIZE / 2);
    expect(y).toBe(FIELD_ORIGIN_Y + (VISIBLE_ROWS - 1) * CELL_SIZE + CELL_SIZE / 2);
  });

  it('places board (5, 11) at the top-right cell center', () => {
    const { x, y } = cellCenter(5, 11);
    expect(x).toBe(FIELD_ORIGIN_X + 5 * CELL_SIZE + CELL_SIZE / 2);
    expect(y).toBe(FIELD_ORIGIN_Y + CELL_SIZE / 2);
  });

  it('renders higher y-values as lower pixel-y', () => {
    const low = cellCenter(2, 0);
    const high = cellCenter(2, 5);
    expect(high.y).toBeLessThan(low.y);
  });
});

describe('colorFor', () => {
  it('returns null for empty cells', () => {
    expect(colorFor(null)).toBeNull();
  });
  it('returns the palette color for each puyo kind', () => {
    for (const kind of ['R', 'G', 'B', 'Y', 'P', 'X'] as const) {
      expect(colorFor(kind)).toBe(PUYO_COLORS[kind]);
    }
  });
});
