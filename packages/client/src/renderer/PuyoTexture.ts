/**
 * Sprite-sheet helper for the main puyo artwork.
 *
 * Sheet layout (`public/assets/puyo/puyo_sozai.png`):
 *   - 32×32 px per sprite
 *   - 6 columns: Red, Green, Yellow, Blue, Purple, Ojama
 *   - 16 rows: one per 4-directional connection pattern (see below)
 *
 * Connection row index is derived from a 4-bit mask
 *   bits = U*8 | D*4 | L*2 | R*1
 * using the table below so that the exact row ordering matches the
 * user-provided asset.
 */

import type { PuyoColor } from '@chaindrop/shared';
import { Assets, Rectangle, Texture } from 'pixi.js';

/**
 * Asset path, relative to Vite's base. The `_v3` suffix forces a fresh
 * fetch when we ship asset edits — `public/` files keep their URL across
 * builds, so the only reliable cache-bust is a filename bump.
 */
export const PUYO_SHEET_PATH = 'assets/puyo/puyo_sozai_v3.png';

/** Pixel size of a single cell in the sprite sheet. */
export const SHEET_CELL = 32;

export interface SpriteConnections {
  up: boolean;
  right: boolean;
  down: boolean;
  left: boolean;
}

/**
 * The ordered column index for each supported cell kind. Verified
 * against the sprite sheet by sampling body pixels — order is
 * R, G, B, Y, P, X (NOT R/G/Y/B/P).
 */
const COLUMN_BY_KIND: Record<PuyoColor | 'X', number> = {
  R: 0,
  G: 1,
  B: 2,
  Y: 3,
  P: 4,
  X: 5,
};

/**
 * Maps the 4-bit connection mask (U8|D4|L2|R1) to the row index in
 * the sprite sheet. Order matches the artwork:
 *   row 0  none
 *   row 1  U
 *   row 2  D
 *   row 3  UD
 *   row 4  L
 *   row 5  UL
 *   row 6  DL
 *   row 7  UDL
 *   row 8  R
 *   row 9  UR
 *   row 10 DR
 *   row 11 UDR
 *   row 12 LR
 *   row 13 ULR
 *   row 14 DLR
 *   row 15 UDLR
 */
const ROW_BY_BITS: readonly number[] = [
  0, // 0b0000 none
  8, // 0b0001 R
  4, // 0b0010 L
  12, // 0b0011 LR
  2, // 0b0100 D
  10, // 0b0101 DR
  6, // 0b0110 DL
  14, // 0b0111 DLR
  1, // 0b1000 U
  9, // 0b1001 UR
  5, // 0b1010 UL
  13, // 0b1011 ULR
  3, // 0b1100 UD
  11, // 0b1101 UDR
  7, // 0b1110 UDL
  15, // 0b1111 UDLR
];

export function connectionsToRow(c: SpriteConnections | undefined): number {
  if (!c) return 0;
  const bits = (c.up ? 8 : 0) | (c.down ? 4 : 0) | (c.left ? 2 : 0) | (c.right ? 1 : 0);
  return ROW_BY_BITS[bits] as number;
}

/**
 * Holder for the base sheet texture plus a grid of sub-textures, one
 * per (column, row) cell. Sub-textures share the underlying GPU texture.
 */
export class PuyoSheet {
  private readonly frames = new Map<string, Texture>();

  private constructor(private base: Texture) {
    // Pre-compute 96 frames up-front — negligible memory.
    for (let col = 0; col < 6; col++) {
      for (let row = 0; row < 16; row++) {
        const frame = new Texture({
          source: base.source,
          frame: new Rectangle(col * SHEET_CELL, row * SHEET_CELL, SHEET_CELL, SHEET_CELL),
        });
        this.frames.set(keyFor(col, row), frame);
      }
    }
  }

  static async load(baseUrl?: string): Promise<PuyoSheet> {
    const url = baseUrl ? `${baseUrl}${PUYO_SHEET_PATH}` : PUYO_SHEET_PATH;
    const texture = (await Assets.load<Texture>(url)) as Texture;
    // Nearest-neighbour filtering so that cropping one 32×32 cell out
    // of the atlas never samples a pixel from the neighbouring row.
    // Without this, linear filtering produced horizontal grey streaks
    // across the up+side connection rows.
    texture.source.scaleMode = 'nearest';
    return new PuyoSheet(texture);
  }

  /** Texture for (kind, connections). Ojama always uses the "none" row. */
  get(kind: PuyoColor | 'X', connections?: SpriteConnections): Texture {
    const col = COLUMN_BY_KIND[kind];
    const row = kind === 'X' ? 0 : connectionsToRow(connections);
    return this.frames.get(keyFor(col, row)) as Texture;
  }

  destroy(): void {
    for (const t of this.frames.values()) t.destroy(false);
    this.frames.clear();
    this.base.destroy(true);
  }
}

function keyFor(col: number, row: number): string {
  return `${col}:${row}`;
}
