/**
 * Pixi-backed field renderer.
 *
 * Visual responsibilities:
 *   - Field frame + grid (drawn once).
 *   - Puyo sprites from the sprite sheet (see `PuyoTexture`). Connection
 *     info picks the right sheet row so same-color neighbours visually
 *     fuse like the original.
 *   - Rotation animation: the child puyo traces a circular arc around
 *     the axis; wall kicks also slide the axis in parallel.
 *   - Horizontal move + natural fall: SNAP to grid.
 *   - Soft drop: smoothed toward target so the slide reads as fluid.
 *   - Gravity fall animation after chain ticks: uniform pixels-per-frame
 *     speed with a gummy bounce when a cell lands.
 *   - Pop animation: grow, fade, rapid-blink during the pop window.
 *   - Burst particles radiate outward when a puyo is cleared.
 *   - Occasional eye blinks on settled puyos (sprite squash).
 */

import type { PlayerState } from '@chaindrop/shared';
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { PuyoSheet } from './PuyoTexture';
import { SHEET_CELL } from './PuyoTexture';
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

/** Target sprite size / texture cell size. Applied as the base scale. */
const BASE_SCALE = CELL_SIZE / SHEET_CELL; // 40 / 32 = 1.25

/** Rotation arc duration in render frames. */
const ROTATION_FRAMES = 6;
/** Lerp factor for smoothed soft-drop descent (per render frame). */
const SOFT_DROP_LERP = 0.35;
/** Gravity-fall speed in pixels per render frame (uniform across columns). */
const FALL_SPEED = CELL_SIZE / 5; // 8 px/frame — slightly less than 1 cell per 5 frames.
/** Duration of the post-fall gummy bounce, in render frames. */
const BOUNCE_FRAMES = 8;
/** Rapid-blink alternation period (render frames) during pop. */
const POP_BLINK_PERIOD = 3;
/** Average frames between idle-blink attempts per puyo. */
const IDLE_BLINK_AVG_INTERVAL = 240; // ~4s at 60fps
/** How long one idle blink lasts. */
const IDLE_BLINK_FRAMES = 6;

/**
 * Screen-space angle (radians) the child sits at for each rotation.
 *   rotation 0 (child BELOW)  → π/2
 *   rotation 1 (child LEFT)   → π
 *   rotation 2 (child ABOVE)  → 3π/2
 *   rotation 3 (child RIGHT)  → 0
 */
const ANGLE_BY_ROTATION: readonly number[] = [Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 0];

interface PieceAnim {
  currentAngle: number;
  displayAxisX: number;
  displayAxisY: number;
  targetAngle: number;
  targetAxisX: number;
  targetAxisY: number;
  rotProgress: number;
  lastRotation: number;
}

interface CellSnapshot {
  kind: string;
  /** Displayed y in pixels right now (includes any in-progress fall). */
  displayY: number;
  /** Target y in pixels (where it should settle). */
  targetY: number;
  /** True while the fall animation is still moving. */
  falling: boolean;
  /** Gummy-bounce frame counter: -1 means inactive, 0..BOUNCE_FRAMES-1 active. */
  bounceFrame: number;
  /** Frames left in an idle blink (0 = not blinking). */
  blinkFrames: number;
  /** Frames until next idle-blink attempt. */
  nextBlinkIn: number;
}

interface BoardEntry {
  sprite: Sprite;
  snap: CellSnapshot;
}

/** One-shot radiating particle used for a pop burst. */
interface Particle {
  graphic: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

export class FieldRenderer {
  readonly container: Container;
  private frameLayer: Graphics;
  private spriteLayer: Container;
  private burstLayer: Container;

  private boardSprites = new Map<string, BoardEntry>();
  private pieceSprites = new Map<string, Sprite>();
  private pieceAnim: PieceAnim | null = null;
  private particles: Particle[] = [];

  constructor(private sheet: PuyoSheet) {
    this.container = new Container();
    this.frameLayer = new Graphics();
    this.spriteLayer = new Container();
    this.burstLayer = new Container();
    this.container.addChild(this.frameLayer);
    this.container.addChild(this.spriteLayer);
    this.container.addChild(this.burstLayer);
    this.drawFrame();
  }

  update(player: PlayerState): void {
    const specs = computeFieldSprites(player);
    this.updateBoardSprites(specs.filter((s) => s.kind === 'board'));
    this.updatePieceSprites(
      specs.filter((s) => s.kind === 'axis' || s.kind === 'child'),
      player,
    );
    this.tickParticles();
  }

  destroy(): void {
    for (const { sprite } of this.boardSprites.values()) sprite.destroy();
    for (const s of this.pieceSprites.values()) s.destroy();
    for (const p of this.particles) p.graphic.destroy();
    this.boardSprites.clear();
    this.pieceSprites.clear();
    this.particles = [];
    this.burstLayer.destroy({ children: true });
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
        this.updateExistingBoardSprite(existing, spec);
      } else {
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

    // Reap cells that vanished. Emit a pop burst at each one so the
    // clear has a satisfying punctuation.
    for (const [id, entry] of this.boardSprites) {
      if (!seen.has(id)) {
        this.emitBurst(entry.sprite.x, entry.snap.displayY, this.getTintForKind(entry.snap.kind));
        this.spriteLayer.removeChild(entry.sprite);
        entry.sprite.destroy();
        this.boardSprites.delete(id);
      }
    }
  }

  private createBoardSprite(spec: FieldSprite): BoardEntry {
    const sprite = makeSprite(this.sheet.get(spec.cellKind, spec.connections));
    sprite.x = spec.x;

    let fallFromY = spec.y;
    let falling = false;
    const sourceId = this.findFallSource(spec);
    if (sourceId) {
      const source = this.boardSprites.get(sourceId);
      if (source) {
        fallFromY = source.snap.displayY;
        falling = fallFromY < spec.y;
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
      falling,
      bounceFrame: -1,
      blinkFrames: 0,
      nextBlinkIn: randomBlinkDelay(),
    };
    const entry: BoardEntry = { sprite, snap };
    this.applyVisualState(entry, spec);
    return entry;
  }

  private updateExistingBoardSprite(entry: BoardEntry, spec: FieldSprite): void {
    entry.sprite.texture = this.sheet.get(spec.cellKind, spec.connections);
    entry.sprite.x = spec.x;
    if (entry.snap.targetY !== spec.y) {
      entry.snap.targetY = spec.y;
      entry.snap.falling = entry.snap.displayY < spec.y;
      entry.snap.bounceFrame = -1;
    }
    this.tickFall(entry);
    this.tickIdleBlink(entry);
    this.applyVisualState(entry, spec);
  }

  /** Uniform-speed fall with a gummy bounce on impact. */
  private tickFall(entry: BoardEntry): void {
    const { snap } = entry;
    if (snap.falling) {
      snap.displayY = Math.min(snap.targetY, snap.displayY + FALL_SPEED);
      if (snap.displayY >= snap.targetY) {
        snap.displayY = snap.targetY;
        snap.falling = false;
        snap.bounceFrame = 0; // trigger bounce
      }
    }
    entry.sprite.y = snap.displayY;

    if (snap.bounceFrame >= 0 && snap.bounceFrame < BOUNCE_FRAMES) {
      snap.bounceFrame += 1;
    } else if (snap.bounceFrame >= BOUNCE_FRAMES) {
      snap.bounceFrame = -1;
    }
  }

  /** Idle eye-blink timer. Slightly randomised so puyos don't sync up. */
  private tickIdleBlink(entry: BoardEntry): void {
    const { snap } = entry;
    if (snap.blinkFrames > 0) {
      snap.blinkFrames -= 1;
      return;
    }
    if (snap.falling || snap.bounceFrame >= 0) return;
    snap.nextBlinkIn -= 1;
    if (snap.nextBlinkIn <= 0) {
      snap.blinkFrames = IDLE_BLINK_FRAMES;
      snap.nextBlinkIn = randomBlinkDelay();
    }
  }

  /**
   * Combined scale + alpha calc per frame. Order of application:
   *   base × bounce × pop × blink
   */
  private applyVisualState(entry: BoardEntry, spec: FieldSprite): void {
    const s = entry.sprite;
    let scaleX = BASE_SCALE;
    let scaleY = BASE_SCALE;
    let alpha = 1;

    // Pop: grow-then-shrink + fade + rapid blink.
    if (spec.popProgress !== undefined && spec.popProgress > 0) {
      const p = Math.min(1, spec.popProgress);
      const popScale =
        p < 0.35 ? 1 + (p / 0.35) * 0.25 : Math.max(0, 1.25 - ((p - 0.35) / 0.65) * 1.25);
      scaleX *= popScale;
      scaleY *= popScale;
      alpha *= Math.max(0, 1 - p * 1.2);
      // Rapid-blink: alternate full/dim alpha every few frames.
      const blinkPhase = Math.floor((p * (15 / POP_BLINK_PERIOD)) % 2);
      if (blinkPhase === 1) alpha *= 0.25;
    }

    // Bounce: quick vertical squish + recovery after landing.
    if (entry.snap.bounceFrame >= 0 && entry.snap.bounceFrame < BOUNCE_FRAMES) {
      const t = entry.snap.bounceFrame / BOUNCE_FRAMES; // 0..1
      // Parabolic easing: squashY goes 1 → 0.78 → 1; width goes 1 → 1.12 → 1
      const bend = Math.sin(t * Math.PI);
      scaleX *= 1 + 0.12 * bend;
      scaleY *= 1 - 0.22 * bend;
    }

    // Idle blink: quick squint on the Y axis.
    if (entry.snap.blinkFrames > 0) {
      const t = 1 - entry.snap.blinkFrames / IDLE_BLINK_FRAMES;
      const bend = Math.sin(t * Math.PI);
      scaleY *= 1 - 0.45 * bend;
    }

    s.scale.set(scaleX, scaleY);
    s.alpha = alpha;
  }

  /**
   * If the spec looks like a new same-color cell that just appeared
   * lower than a now-gone sprite in the same column, return that
   * source's id so we can hand off its displayed y for the fall.
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

  /** RGB tint for particles when a cell of `kind` pops. */
  private getTintForKind(kind: string): number {
    switch (kind) {
      case 'R':
        return 0xff4a6b;
      case 'G':
        return 0x6ce048;
      case 'Y':
        return 0xffd23a;
      case 'B':
        return 0x4a9bff;
      case 'P':
        return 0xc864ff;
      default:
        return 0xffffff;
    }
  }

  // ----------------------------------------------------------------
  // Particles (pop bursts)
  // ----------------------------------------------------------------

  private emitBurst(x: number, y: number, color: number): void {
    const count = 6;
    for (let i = 0; i < count; i++) {
      const g = new Graphics();
      g.circle(0, 0, 3);
      g.fill({ color, alpha: 1 });
      g.x = x;
      g.y = y;
      this.burstLayer.addChild(g);
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const speed = 3 + Math.random() * 2;
      this.particles.push({
        graphic: g,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        life: 18,
        maxLife: 18,
      });
    }
  }

  private tickParticles(): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i] as Particle;
      p.graphic.x += p.vx;
      p.graphic.y += p.vy;
      p.vy += 0.25; // gravity
      p.life -= 1;
      p.graphic.alpha = p.life / p.maxLife;
      if (p.life <= 0) {
        this.burstLayer.removeChild(p.graphic);
        p.graphic.destroy();
        this.particles.splice(i, 1);
      }
    }
  }

  // ----------------------------------------------------------------
  // Active piece
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
      // Rotation change → start a fresh arc animation.
      const fromAngle = this.pieceAnim.currentAngle;
      const toAngle = pickShortTarget(fromAngle, targetAngle);
      this.pieceAnim.targetAngle = toAngle;
      this.pieceAnim.targetAxisX = targetAxisX;
      this.pieceAnim.targetAxisY = targetAxisY;
      this.pieceAnim.rotProgress = 0;
      this.pieceAnim.lastRotation = piece.rotation;
    } else {
      // No rotation change. Horizontal move → SNAP. Soft drop
      // descent → SMOOTH. Natural fall → SNAP.
      this.pieceAnim.currentAngle = targetAngle;
      this.pieceAnim.targetAngle = targetAngle;
      this.pieceAnim.targetAxisX = targetAxisX;
      this.pieceAnim.targetAxisY = targetAxisY;
      this.pieceAnim.rotProgress = 1;

      // Horizontal always snaps.
      this.pieceAnim.displayAxisX = targetAxisX;

      // Vertical: smooth while soft-dropping, snap otherwise.
      if (player.softDrop && targetAxisY !== this.pieceAnim.displayAxisY) {
        const dy = targetAxisY - this.pieceAnim.displayAxisY;
        this.pieceAnim.displayAxisY += dy * SOFT_DROP_LERP;
        if (Math.abs(dy) < 0.5) this.pieceAnim.displayAxisY = targetAxisY;
      } else {
        this.pieceAnim.displayAxisY = targetAxisY;
      }
    }

    // Rotation animation progress.
    if (this.pieceAnim.rotProgress < 1) {
      const prev = this.pieceAnim.rotProgress;
      const next = Math.min(1, prev + 1 / ROTATION_FRAMES);
      this.pieceAnim.rotProgress = next;
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
    axisSprite.scale.set(BASE_SCALE);
    axisSprite.alpha = 1;
    const angle = this.pieceAnim.currentAngle;
    childSprite.x = this.pieceAnim.displayAxisX + Math.cos(angle) * CELL_SIZE;
    childSprite.y = this.pieceAnim.displayAxisY + Math.sin(angle) * CELL_SIZE;
    childSprite.scale.set(BASE_SCALE);
    childSprite.alpha = 1;
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
  // Use scale (not width/height) so that downstream scale.set() calls
  // multiply the base rather than reset it.
  s.scale.set(BASE_SCALE);
  return s;
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

function randomBlinkDelay(): number {
  // Poisson-ish: uniform 0.5x..1.5x of the mean, per-puyo random offset.
  const jitter = 0.5 + Math.random();
  return Math.floor(IDLE_BLINK_AVG_INTERVAL * jitter);
}
