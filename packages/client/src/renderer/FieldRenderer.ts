/**
 * Pixi-backed field renderer.
 *
 * Responsibilities:
 *   - Draw the field frame + grid once.
 *   - Maintain a set of puyo sprites, diffed by id so we only create
 *     / update / destroy on actual change.
 *   - Smooth rotation / wall-kick / fall motion for the active piece
 *     by lerping its displayed position toward the logical target.
 *   - Animate pops: cells in a resolving cluster grow-then-shrink
 *     and fade.
 *   - Render same-color adjacency as connector nubs so neighbouring
 *     puyos visually fuse (classic Puyo Puyo look, using programmer
 *     art for now).
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

/** Per-render-frame lerp factor for the active piece's position. */
const PIECE_LERP = 0.3;
/** Distance above which we snap rather than lerp (e.g. new spawn). */
const SNAP_DISTANCE = CELL_SIZE * 3;

interface SpriteView {
  graphic: Graphics;
  /** Displayed position — may trail the target while animating. */
  displayX: number;
  displayY: number;
}

export class FieldRenderer {
  readonly container: Container;
  private frameLayer: Graphics;
  private spriteLayer: Container;
  private sprites = new Map<string, SpriteView>();

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
        this.applyExisting(existing, spec);
      } else {
        const view = this.createSprite(spec);
        this.sprites.set(spec.id, view);
        this.spriteLayer.addChild(view.graphic);
      }
    }

    // Reap stale sprites.
    for (const [id, view] of this.sprites) {
      if (!seen.has(id)) {
        this.spriteLayer.removeChild(view.graphic);
        view.graphic.destroy();
        this.sprites.delete(id);
      }
    }
  }

  destroy(): void {
    for (const view of this.sprites.values()) view.graphic.destroy();
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

  private createSprite(spec: FieldSprite): SpriteView {
    const g = new Graphics();
    const view: SpriteView = {
      graphic: g,
      // New sprites start exactly at their target — no lerp-in from 0.
      displayX: spec.x,
      displayY: spec.y,
    };
    this.paint(view, spec);
    return view;
  }

  private applyExisting(view: SpriteView, spec: FieldSprite): void {
    const isPieceSprite = spec.id === 'piece:axis' || spec.id === 'piece:child';
    if (isPieceSprite) {
      const dx = spec.x - view.displayX;
      const dy = spec.y - view.displayY;
      const dist = Math.hypot(dx, dy);
      if (dist > SNAP_DISTANCE) {
        view.displayX = spec.x;
        view.displayY = spec.y;
      } else {
        view.displayX += dx * PIECE_LERP;
        view.displayY += dy * PIECE_LERP;
      }
    } else {
      // Board cells don't move, stay pinned to their spec position.
      view.displayX = spec.x;
      view.displayY = spec.y;
    }
    this.paint(view, spec);
  }

  /**
   * Redraw the Graphics for a sprite. Connectors are drawn first so
   * the circle body sits on top. The whole sprite is scaled / faded
   * according to pop progress when present.
   */
  private paint(view: SpriteView, spec: FieldSprite): void {
    const g = view.graphic;
    g.clear();

    // Connector nubs toward same-color neighbours.
    const reach = CELL_SIZE / 2 + 1; // slight overshoot so neighbours overlap cleanly
    const nubW = PUYO_RADIUS * 1.15;
    const nubH = PUYO_RADIUS * 1.15;
    if (spec.connections) {
      const c = spec.connections;
      if (c.up) {
        g.rect(-nubW / 2, -reach, nubW, reach);
        g.fill(spec.color);
      }
      if (c.down) {
        g.rect(-nubW / 2, 0, nubW, reach);
        g.fill(spec.color);
      }
      if (c.left) {
        g.rect(-reach, -nubH / 2, reach, nubH);
        g.fill(spec.color);
      }
      if (c.right) {
        g.rect(0, -nubH / 2, reach, nubH);
        g.fill(spec.color);
      }
    }

    // Body circle.
    g.circle(0, 0, PUYO_RADIUS);
    g.fill(spec.color);
    g.stroke({ width: 2, color: darken(spec.color, 0.4) });

    g.x = view.displayX;
    g.y = view.displayY;

    // Pop animation: grow briefly, then shrink and fade.
    if (spec.popProgress !== undefined && spec.popProgress > 0) {
      const p = Math.min(1, spec.popProgress);
      // Curve: scale up to 1.25 around p=0.35, then shrink to 0.
      const scale =
        p < 0.35 ? 1 + (p / 0.35) * 0.25 : Math.max(0, 1.25 - ((p - 0.35) / 0.65) * 1.25);
      g.scale.set(scale);
      g.alpha = Math.max(0, 1 - p * 1.2);
    } else {
      g.scale.set(1);
      g.alpha = 1;
    }
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
