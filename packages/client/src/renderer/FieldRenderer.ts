/**
 * Pixi-backed field renderer.
 *
 * Responsibilities:
 *   - Draw the field frame + grid once.
 *   - Maintain a set of puyo sprites, diffed by id so we only create
 *     / update / destroy on actual change.
 *   - Accept a fresh `PlayerState` each frame via `update()`.
 *
 * The heavy lifting (state → sprite specs) lives in the pure
 * `computeFieldSprites` function so that logic is unit-tested without
 * needing WebGL. This file owns the mapping between sprite specs and
 * live `PIXI.Graphics` objects.
 */

import type { PlayerState } from '@chaindrop/shared';
import { Container, Graphics } from 'pixi.js';
import { type FieldSprite, computeFieldSprites } from './fieldView';
import {
  CELL_SIZE,
  FIELD_COLS,
  FIELD_ORIGIN_X,
  FIELD_ORIGIN_Y,
  FIELD_PIXEL_HEIGHT,
  FIELD_PIXEL_WIDTH,
  PUYO_RADIUS,
  VISIBLE_ROWS,
} from './layout';

const FRAME_LINE_COLOR = 0xffd60a;
const GRID_LINE_COLOR = 0x2a2a44;

export class FieldRenderer {
  readonly container: Container;
  private frameLayer: Graphics;
  private spriteLayer: Container;
  private sprites = new Map<string, Graphics>();

  constructor() {
    this.container = new Container();
    this.frameLayer = new Graphics();
    this.spriteLayer = new Container();
    this.container.addChild(this.frameLayer);
    this.container.addChild(this.spriteLayer);
    this.drawFrame();
  }

  /**
   * Apply a fresh `PlayerState` to the scene graph. Sprites not in
   * the new list are destroyed; new ones are created; existing ones
   * are repositioned in-place.
   */
  update(player: PlayerState, alpha = 0): void {
    const specs = computeFieldSprites(player, alpha);
    const seen = new Set<string>();

    for (const spec of specs) {
      seen.add(spec.id);
      const existing = this.sprites.get(spec.id);
      if (existing) {
        this.applySprite(existing, spec);
      } else {
        const g = this.createSprite(spec);
        this.sprites.set(spec.id, g);
        this.spriteLayer.addChild(g);
      }
    }

    // Reap stale sprites.
    for (const [id, g] of this.sprites) {
      if (!seen.has(id)) {
        this.spriteLayer.removeChild(g);
        g.destroy();
        this.sprites.delete(id);
      }
    }
  }

  destroy(): void {
    for (const g of this.sprites.values()) g.destroy();
    this.sprites.clear();
    this.spriteLayer.destroy({ children: true });
    this.frameLayer.destroy();
    this.container.destroy({ children: true });
  }

  // ---- internals ----

  private drawFrame(): void {
    const g = this.frameLayer;
    g.clear();

    // Fill the field background.
    g.rect(FIELD_ORIGIN_X, FIELD_ORIGIN_Y, FIELD_PIXEL_WIDTH, FIELD_PIXEL_HEIGHT);
    g.fill(0x0c0c1f);

    // Grid lines (subtle).
    for (let i = 1; i < FIELD_COLS; i++) {
      const x = FIELD_ORIGIN_X + i * CELL_SIZE;
      g.moveTo(x, FIELD_ORIGIN_Y);
      g.lineTo(x, FIELD_ORIGIN_Y + FIELD_PIXEL_HEIGHT);
    }
    for (let j = 1; j < VISIBLE_ROWS; j++) {
      const y = FIELD_ORIGIN_Y + j * CELL_SIZE;
      g.moveTo(FIELD_ORIGIN_X, y);
      g.lineTo(FIELD_ORIGIN_X + FIELD_PIXEL_WIDTH, y);
    }
    g.stroke({ width: 1, color: GRID_LINE_COLOR, alpha: 0.6 });

    // Outer frame.
    g.rect(FIELD_ORIGIN_X, FIELD_ORIGIN_Y, FIELD_PIXEL_WIDTH, FIELD_PIXEL_HEIGHT);
    g.stroke({ width: 3, color: FRAME_LINE_COLOR });
  }

  private createSprite(spec: FieldSprite): Graphics {
    const g = new Graphics();
    this.applySprite(g, spec);
    return g;
  }

  private applySprite(g: Graphics, spec: FieldSprite): void {
    g.clear();
    g.circle(0, 0, PUYO_RADIUS);
    g.fill(spec.color);
    g.stroke({ width: 2, color: darken(spec.color, 0.4) });
    g.x = spec.x;
    g.y = spec.y;
  }
}

function darken(color: number, factor: number): number {
  const r = (color >> 16) & 0xff;
  const gc = (color >> 8) & 0xff;
  const b = color & 0xff;
  const f = 1 - factor;
  return (
    ((Math.max(0, Math.floor(r * f)) & 0xff) << 16) |
    ((Math.max(0, Math.floor(gc * f)) & 0xff) << 8) |
    (Math.max(0, Math.floor(b * f)) & 0xff)
  );
}
