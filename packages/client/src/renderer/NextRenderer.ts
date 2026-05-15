/**
 * NEXT preview — shows the three upcoming pieces in a small panel
 * next to the main field.
 *
 * Layout (solo, right of the field):
 *   - Piece 1: full size, topmost
 *   - Piece 2: slightly smaller, below piece 1
 *   - Piece 3: same scale as piece 2, positioned far enough right
 *     that 70% of its width sits beyond the panel's visible edge.
 *     A rectangular mask clips anything outside the panel.
 */

import type { MatchState } from '@chaindrop/shared';
import { Container, Graphics, Sprite } from 'pixi.js';
import type { PuyoSheet } from './PuyoTexture';
import { SHEET_CELL } from './PuyoTexture';

const PANEL_X = 820;
const PANEL_Y = 120;
const PANEL_WIDTH = 110;
const PANEL_HEIGHT = 440;

const CELL_SIZES: readonly number[] = [40, 32, 32];
const VERTICAL_GAP = 24;
/** For piece 3: how much of its width is inside the panel (30%). */
const PIECE3_VISIBLE_FRACTION = 0.3;

const FRAME_COLOR = 0xffd60a;
const PANEL_BG = 0x0c0c1f;

export class NextRenderer {
  readonly container: Container;
  private frame: Graphics;
  private slots: Container[] = [];
  private slotSprites: { axis: Sprite; child: Sprite }[] = [];

  constructor(private sheet: PuyoSheet) {
    this.container = new Container();
    this.frame = new Graphics();
    this.container.addChild(this.frame);

    const mask = new Graphics();
    mask.rect(PANEL_X, PANEL_Y, PANEL_WIDTH, PANEL_HEIGHT);
    mask.fill(0xffffff);
    this.container.addChild(mask);
    this.container.mask = mask;

    this.drawFrame();
    this.buildSlots();
  }

  update(match: MatchState, playerIndex = 0): void {
    const player = match.players[playerIndex];
    if (!player) return;
    const baseIndex = player.dropQueueIndex;

    // `dropQueueIndex` is the index of the NEXT piece to spawn —
    // i.e., what *will* drop after the current piece locks. So the
    // panel slots map directly to (baseIndex + 0, +1, +2).
    for (let i = 0; i < 3; i++) {
      const pair = match.dropQueue[baseIndex + i];
      const sprites = this.slotSprites[i];
      const slot = this.slots[i];
      if (!slot || !sprites) continue;
      if (pair) {
        const [axisColor, childColor] = pair;
        sprites.axis.texture = this.sheet.get(axisColor);
        sprites.child.texture = this.sheet.get(childColor);
        slot.visible = true;
      } else {
        slot.visible = false;
      }
    }
  }

  destroy(): void {
    for (const slot of this.slots) slot.destroy({ children: true });
    this.slots = [];
    this.slotSprites = [];
    this.frame.destroy();
    this.container.destroy({ children: true });
  }

  // ----------------------------------------------------------------

  private drawFrame(): void {
    const g = this.frame;
    g.clear();
    g.rect(PANEL_X, PANEL_Y, PANEL_WIDTH, PANEL_HEIGHT);
    g.fill(PANEL_BG);
    g.rect(PANEL_X, PANEL_Y, PANEL_WIDTH, PANEL_HEIGHT);
    g.stroke({ width: 2, color: FRAME_COLOR });
  }

  private buildSlots(): void {
    let y = PANEL_Y + 40;
    for (let i = 0; i < 3; i++) {
      const cell = CELL_SIZES[i] as number;
      const pieceHeight = cell * 2;

      const slot = new Container();
      slot.x =
        i === 2
          ? PANEL_X + PANEL_WIDTH - cell * PIECE3_VISIBLE_FRACTION
          : PANEL_X + PANEL_WIDTH / 2;
      slot.y = y + cell / 2;

      // Use explicit scale from the known sheet cell size so that the
      // scale stays correct across later texture swaps.
      const renderScale = cell / SHEET_CELL;

      const axis = new Sprite();
      axis.anchor.set(0.5);
      axis.scale.set(renderScale);
      axis.x = 0;
      axis.y = 0;
      slot.addChild(axis);

      const child = new Sprite();
      child.anchor.set(0.5);
      child.scale.set(renderScale);
      child.x = 0;
      child.y = cell;
      slot.addChild(child);

      this.slots.push(slot);
      this.slotSprites.push({ axis, child });
      this.container.addChild(slot);

      y += pieceHeight + VERTICAL_GAP;
    }
  }
}
