/**
 * Pixi-backed field renderer.
 *
 * Visual responsibilities:
 *   - Field frame + grid (drawn once).
 *   - Per-cell puyo sprites pulled from the sprite sheet (see
 *     `PuyoTexture`). Connection info picks the right sheet row so
 *     same-color neighbours visually fuse like the original.
 *   - Rotation animation: when the piece's rotation changes, the
 *     child puyo traces a circular arc around the axis (not a
 *     diagonal lerp). Wall kicks animate the axis sliding at the
 *     same time.
 *   - Natural fall and horizontal move: SNAP — no smoothing.
 *   - Gravity fall animation: when cells land on lower rows after a
 *     chain tick, they visibly fall from their previous y to their
 *     new y with an ease-in curve.
 *   - Pop animation: during the first half of a chain tick the
 *     popping cells grow briefly then shrink and fade.
 *
 * The pure state → sprite list mapping still lives in
 * `computeFieldSprites`; this file just consumes the specs and
 * manages live scene-graph objects.
 */

import type { PlayerState } from '@chaindrop/shared';
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { PuyoSheet } from './PuyoTexture';
import { type FieldSprite, computeFieldSprites } from './fieldView';
import {
  CELL_SIZE,
  FIELD_COLS,
  FIELD_ORIGIN_X,
  FIELD_ORIGIN_Y,
  FIELD_PIXEL_HEIGHT,
  FIELD_PIXEL_WIDTH,
  VISIBLE_ROWS,
} from './layout';

const FRAME_LINE_COLOR = 0xffd60a;
const GRID_LINE_COLOR = 0x2a2a44;

/** Frames it takes the rotation arc animation to complete. */
const ROTATION_FRAMES = 6;
/** Frames it takes a gravity-fallen cell to reach its final position. */
const FALL_FRAMES = 12;

/**
 * Which screen-space angle (radians) the child sits at for each
 * rotation. Screen coords: x+ right, y+ down. A right-handed angle
 * where 0 points right grows clockwise in screen space.
 *   rotation 0 (child BELOW)  → π/2
 *   rotation 1 (child LEFT)   → π
 *   rotation 2 (child ABOVE)  → 3π/2
 *   rotation 3 (child RIGHT)  → 0
 */
const ANGLE_BY_ROTATION: readonly number[] = [Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 0];

interface PieceAnim {
  /** Angle of the child relative to axis, in radians (continuous, unwrapped). */
  currentAngle: number;
  /** Axis display position (interpolated during wall kicks). */
  displayAxisX: number;
  displayAxisY: number;
  /** Target angle the animation is moving toward. */
  targetAngle: number;
  targetAxisX: number;
  targetAxisY: number;
  /** 0..1 progress of the active rotation animation (1 = settled). */
  rotProgress: number;
  /** The piece's rotation we last saw — used to detect change. */
  lastRotation: number;
}

/** Snapshot of what's drawn at each board cell right now. */
interface CellSnapshot {
  kind: string;
  /** Displayed y in pixels (includes any in-progress fall). */
  displayY: number;
  /** Target y in pixels (where it should settle). */
  targetY: number;
  /** 0..1 progress of the fall animation; 1 = settled. */
  fallProgress: number;
}

export class FieldRenderer {
  readonly container: Container;
  private frameLayer: Graphics;
  private spriteLayer: Container;

  private boardSprites = new Map<string, { sprite: Sprite; snap: CellSnapshot }>();
  private pieceSprites = new Map<string, Sprite>();
  private pieceAnim: PieceAnim | null = null;

  constructor(private sheet: PuyoSheet) {
    this.container = new Container();
    this.frameLayer = new Graphics();
    this.spriteLayer = new Container();
    this.container.addChild(this.frameLayer);
    this.container.addChild(this.spriteLayer);
    this.drawFrame();
  }

  /** Apply a fresh `PlayerState` to the scene. Called each render frame. */
  update(player: PlayerState): void {
    const specs = computeFieldSprites(player);
    this.updateBoardSprites(specs.filter((s) => s.kind === 'board'));
    this.updatePieceSprites(
      specs.filter((s) => s.kind === 'axis' || s.kind === 'child'),
      player,
    );
  }

  destroy(): void {
    for (const { sprite } of this.boardSprites.values()) sprite.destroy();
    for (const s of this.pieceSprites.values()) s.destroy();
    this.boardSprites.clear();
    this.pieceSprites.clear();
    this.spriteLayer.destroy({ children: true });
    this.frameLayer.destroy();
    this.container.destroy({ children: true });
  }

  // ----------------------------------------------------------------
  // Board cells
  // ----------------------------------------------------------------

  private updateBoardSprites(specs: FieldSprite[]): void {
    const seen = new Set<string>();

    for (const spec of specs) {
      seen.add(spec.id);
      const existing = this.boardSprites.get(spec.id);
      if (existing && existing.snap.kind === spec.cellKind) {
        // Same slot, same color — just refresh.
        this.updateExistingBoardSprite(existing, spec);
      } else {
        // Either brand new, or same slot received a different color
        // (a same-column same-color cell fell into this slot from
        // above). Rebuild so `findFallSource` can animate the drop.
        if (existing) {
          this.spriteLayer.removeChild(existing.sprite);
          existing.sprite.destroy();
          this.boardSprites.delete(spec.id);
        }
        const entry = this.createBoardSprite(spec);
        this.boardSprites.set(spec.id, entry);
        this.spriteLayer.addChild(entry.sprite);
      }
    }

    // Reap cells that are no longer present.
    for (const [id, entry] of this.boardSprites) {
      if (!seen.has(id)) {
        this.spriteLayer.removeChild(entry.sprite);
        entry.sprite.destroy();
        this.boardSprites.delete(id);
      }
    }
  }

  private createBoardSprite(spec: FieldSprite): { sprite: Sprite; snap: CellSnapshot } {
    const sprite = makeSprite(this.sheet.get(spec.cellKind, spec.connections));
    sprite.x = spec.x;

    // If an equivalent colored cell existed somewhere in the same
    // column at a higher y and just vanished, we treat this as a
    // fall — animate the sprite from the vanished position down to
    // the new spec.y. Otherwise it pops in place.
    let fallFromY = spec.y;
    let fallProgress = 1;
    const sourceId = this.findFallSource(spec);
    if (sourceId) {
      const source = this.boardSprites.get(sourceId);
      if (source) {
        fallFromY = source.snap.displayY;
        fallProgress = 0;
        this.spriteLayer.removeChild(source.sprite);
        source.sprite.destroy();
        this.boardSprites.delete(sourceId);
      }
    }

    sprite.y = fallFromY;
    const snap: CellSnapshot = {
      kind: spec.cellKind,
      displayY: fallFromY,
      targetY: spec.y,
      fallProgress,
    };
    applyPopTransform(sprite, spec);
    return { sprite, snap };
  }

  private updateExistingBoardSprite(
    entry: { sprite: Sprite; snap: CellSnapshot },
    spec: FieldSprite,
  ): void {
    // Refresh texture in case connections changed.
    entry.sprite.texture = this.sheet.get(spec.cellKind, spec.connections);
    entry.sprite.x = spec.x;
    if (entry.snap.targetY !== spec.y) {
      entry.snap.targetY = spec.y;
      entry.snap.fallProgress = 0;
    }
    this.tickFall(entry);
    applyPopTransform(entry.sprite, spec);
  }

  /** Advance the fall animation by one render frame. */
  private tickFall(entry: { sprite: Sprite; snap: CellSnapshot }): void {
    if (entry.snap.fallProgress >= 1) {
      entry.snap.displayY = entry.snap.targetY;
      entry.sprite.y = entry.snap.targetY;
      return;
    }
    const prev = entry.snap.fallProgress;
    const next = Math.min(1, prev + 1 / FALL_FRAMES);
    entry.snap.fallProgress = next;
    const fromY = entry.snap.displayY;
    const toY = entry.snap.targetY;
    // Advance as a fraction of the REMAINING distance this frame,
    // which gives a smooth ease-out as we approach the target without
    // requiring us to remember the original source y.
    const stepT = (next - prev) / Math.max(1e-6, 1 - prev);
    entry.snap.displayY = fromY + (toY - fromY) * stepT;
    entry.sprite.y = entry.snap.displayY;
  }

  /**
   * If the spec looks like a new cell that just appeared in a column
   * that currently has a same-color sprite at a higher y (about to
   * become stale because the sim cleared/gravity-moved it), return
   * that sprite's id so we can hand off its visual y.
   */
  private findFallSource(spec: FieldSprite): string | null {
    const m = /^cell:(\d+):(\d+)$/.exec(spec.id);
    if (!m) return null;
    const x = Number(m[1]);
    const y = Number(m[2]);
    let bestSourceId: string | null = null;
    let bestY = -1;
    for (const [id, entry] of this.boardSprites) {
      if (!id.startsWith(`cell:${x}:`)) continue;
      if (entry.snap.kind !== spec.cellKind) continue;
      const m2 = /^cell:\d+:(\d+)$/.exec(id);
      if (!m2) continue;
      const sourceY = Number(m2[1]);
      if (sourceY <= y) continue;
      if (sourceY > bestY) {
        bestY = sourceY;
        bestSourceId = id;
      }
    }
    return bestSourceId;
  }

  // ----------------------------------------------------------------
  // Active piece (axis + child)
  // ----------------------------------------------------------------

  private updatePieceSprites(specs: FieldSprite[], player: PlayerState): void {
    const axisSpec = specs.find((s) => s.kind === 'axis') ?? null;
    const childSpec = specs.find((s) => s.kind === 'child') ?? null;
    const piece = player.current;

    if (!piece || !axisSpec || !childSpec) {
      for (const sprite of this.pieceSprites.values()) {
        this.spriteLayer.removeChild(sprite);
        sprite.destroy();
      }
      this.pieceSprites.clear();
      this.pieceAnim = null;
      return;
    }

    let axisSprite = this.pieceSprites.get('axis');
    let childSprite = this.pieceSprites.get('child');
    if (!axisSprite) {
      axisSprite = makeSprite(this.sheet.get(axisSpec.cellKind));
      this.pieceSprites.set('axis', axisSprite);
      this.spriteLayer.addChild(axisSprite);
    } else {
      axisSprite.texture = this.sheet.get(axisSpec.cellKind);
    }
    if (!childSprite) {
      childSprite = makeSprite(this.sheet.get(childSpec.cellKind));
      this.pieceSprites.set('child', childSprite);
      this.spriteLayer.addChild(childSprite);
    } else {
      childSprite.texture = this.sheet.get(childSpec.cellKind);
    }

    const targetAngle = ANGLE_BY_ROTATION[piece.rotation] as number;
    const targetAxisX = axisSpec.x;
    const targetAxisY = axisSpec.y;

    if (!this.pieceAnim) {
      this.pieceAnim = {
        currentAngle: targetAngle,
        displayAxisX: targetAxisX,
        displayAxisY: targetAxisY,
        targetAngle,
        targetAxisX,
        targetAxisY,
        rotProgress: 1,
        lastRotation: piece.rotation,
      };
    } else if (piece.rotation !== this.pieceAnim.lastRotation) {
      // Rotation change — start a fresh arc from the current visual
      // state toward the new target. For wall kicks the axis also
      // needs to slide; we lerp both in parallel.
      const fromAngle = this.pieceAnim.currentAngle;
      const toAngle = pickShortTarget(fromAngle, targetAngle);
      this.pieceAnim.targetAngle = toAngle;
      this.pieceAnim.targetAxisX = targetAxisX;
      this.pieceAnim.targetAxisY = targetAxisY;
      this.pieceAnim.rotProgress = 0;
      this.pieceAnim.lastRotation = piece.rotation;
    } else {
      // Horizontal move or natural fall — SNAP.
      this.pieceAnim.currentAngle = targetAngle;
      this.pieceAnim.displayAxisX = targetAxisX;
      this.pieceAnim.displayAxisY = targetAxisY;
      this.pieceAnim.targetAngle = targetAngle;
      this.pieceAnim.targetAxisX = targetAxisX;
      this.pieceAnim.targetAxisY = targetAxisY;
      this.pieceAnim.rotProgress = 1;
    }

    // Advance the rotation animation if active.
    if (this.pieceAnim.rotProgress < 1) {
      const prev = this.pieceAnim.rotProgress;
      const next = Math.min(1, prev + 1 / ROTATION_FRAMES);
      this.pieceAnim.rotProgress = next;
      // Ease-out. We advance a FRACTION of the remaining distance each
      // frame, so the "currentAngle" field always holds what we're
      // currently displaying.
      const stepT =
        (easeOutCubic(next) - easeOutCubic(prev)) / Math.max(1e-6, 1 - easeOutCubic(prev));
      this.pieceAnim.currentAngle +=
        (this.pieceAnim.targetAngle - this.pieceAnim.currentAngle) * stepT;
      this.pieceAnim.displayAxisX +=
        (this.pieceAnim.targetAxisX - this.pieceAnim.displayAxisX) * stepT;
      this.pieceAnim.displayAxisY +=
        (this.pieceAnim.targetAxisY - this.pieceAnim.displayAxisY) * stepT;
      if (next === 1) {
        this.pieceAnim.currentAngle = this.pieceAnim.targetAngle;
        this.pieceAnim.displayAxisX = this.pieceAnim.targetAxisX;
        this.pieceAnim.displayAxisY = this.pieceAnim.targetAxisY;
      }
    }

    axisSprite.x = this.pieceAnim.displayAxisX;
    axisSprite.y = this.pieceAnim.displayAxisY;
    const angle = this.pieceAnim.currentAngle;
    childSprite.x = this.pieceAnim.displayAxisX + Math.cos(angle) * CELL_SIZE;
    childSprite.y = this.pieceAnim.displayAxisY + Math.sin(angle) * CELL_SIZE;
  }

  // ----------------------------------------------------------------
  // Field frame
  // ----------------------------------------------------------------

  private drawFrame(): void {
    const g = this.frameLayer;
    g.clear();

    g.rect(FIELD_ORIGIN_X, FIELD_ORIGIN_Y, FIELD_PIXEL_WIDTH, FIELD_PIXEL_HEIGHT);
    g.fill(0x0c0c1f);

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

    g.rect(FIELD_ORIGIN_X, FIELD_ORIGIN_Y, FIELD_PIXEL_WIDTH, FIELD_PIXEL_HEIGHT);
    g.stroke({ width: 3, color: FRAME_LINE_COLOR });
  }
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeSprite(texture: Texture): Sprite {
  const s = new Sprite(texture);
  s.anchor.set(0.5);
  s.width = CELL_SIZE;
  s.height = CELL_SIZE;
  return s;
}

function applyPopTransform(sprite: Sprite, spec: FieldSprite): void {
  if (spec.popProgress !== undefined && spec.popProgress > 0) {
    const p = Math.min(1, spec.popProgress);
    const scale = p < 0.35 ? 1 + (p / 0.35) * 0.25 : Math.max(0, 1.25 - ((p - 0.35) / 0.65) * 1.25);
    sprite.scale.set(scale);
    sprite.alpha = Math.max(0, 1 - p * 1.2);
  } else {
    sprite.scale.set(1);
    sprite.alpha = 1;
  }
}

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

function pickShortTarget(from: number, naiveTarget: number): number {
  let delta = naiveTarget - from;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return from + delta;
}
