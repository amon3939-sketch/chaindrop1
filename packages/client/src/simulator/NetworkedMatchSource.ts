/**
 * NetworkedMatchSource — lockstep MatchSource backed by Colyseus.
 *
 * Sits in the same shape as `LocalMatchSource` so the existing
 * `FrameScheduler` can drive an online match without modification:
 *
 *   submitInput(frame, actions) → wire that input to the SERVER tagged
 *                                 for `frame + inputDelay`.
 *   getInputBatch(frame)        → return the authoritative batch the
 *                                 server has confirmed for `frame`, or
 *                                 `null` if it has not arrived yet.
 *
 * Lockstep with input delay: every action is applied D frames after
 * the keystroke. That delay covers the round-trip to the server and
 * back so the local sim is never starved waiting for the batch. See
 * D4 §4 (frame-progress protocol) and D6 §7 (server-side InputRelay).
 *
 * STATE_HASH is sent every `hashEveryFrames` frames so the server can
 * cross-check determinism.
 */

import {
  type InputAction,
  type MatchConfig,
  type MatchState,
  type PlayerId,
  type PlayerInit,
  type PuyoColor,
  computeHash,
  createMatchState,
} from '@chaindrop/shared';
import type { Room } from 'colyseus.js';
import { onMatchMessage } from '../network/colyseusClient';
import type { Frame, InputBatch, MatchSource } from './MatchSource';

export interface NetworkedMatchSourceOptions {
  room: Room<unknown>;
  /** Player ids in slot order, exactly as the server announced in MATCH_START. */
  playerOrder: readonly PlayerId[];
  myPlayerId: PlayerId;
  seed: number;
  colorMode: 4 | 5;
  /**
   * Frames the server's drop queue contained. Must match what
   * generateDropQueue produces from `seed` + `colorMode`, but is
   * passed in explicitly so we can sanity-check.
   */
  dropQueue: readonly (readonly [PuyoColor, PuyoColor])[];
  /** Inputs entered locally on frame F apply on the simulator at F + inputDelay. */
  inputDelay?: number;
  /** Frames between STATE_HASH submissions. */
  hashEveryFrames?: number;
}

const DEFAULT_INPUT_DELAY = 4;
const DEFAULT_HASH_INTERVAL = 60;

export class NetworkedMatchSource implements MatchSource {
  readonly myPlayerId: PlayerId;
  readonly match: MatchState;

  private readonly inputDelay: number;
  private readonly hashEveryFrames: number;
  private readonly room: Room<unknown>;
  private readonly pendingBatches = new Map<Frame, InputBatch>();
  private readonly endHandlers: ((winnerId: PlayerId | null) => void)[] = [];
  private disposed = false;
  private endFired = false;

  constructor(opts: NetworkedMatchSourceOptions) {
    this.room = opts.room;
    this.myPlayerId = opts.myPlayerId;
    this.inputDelay = opts.inputDelay ?? DEFAULT_INPUT_DELAY;
    this.hashEveryFrames = opts.hashEveryFrames ?? DEFAULT_HASH_INTERVAL;

    const players: PlayerInit[] = opts.playerOrder.map((id, i) => ({ id, slotIndex: i }));
    const config: MatchConfig = {
      seed: opts.seed,
      colorMode: opts.colorMode,
      players,
      dropQueueLength: opts.dropQueue.length,
    };
    this.match = createMatchState(config);

    // The first `inputDelay` frames must run before any locally-typed
    // input could possibly have made the server round-trip back. Pre-
    // populate empty batches so the scheduler isn't stalled at boot.
    for (let f = 0; f < this.inputDelay; f++) {
      this.pendingBatches.set(f, this.emptyBatch(opts.playerOrder));
    }

    onMatchMessage(this.room, (msg) => {
      if (this.disposed) return;
      switch (msg.t) {
        case 'INPUT_BATCH': {
          // The wire shape is Record<PlayerId, InputAction[]>; the
          // simulator accepts the same shape directly.
          this.pendingBatches.set(msg.frame, msg.inputs as InputBatch);
          break;
        }
        case 'MATCH_END':
          this.fireEnd(msg.winnerId);
          break;
        case 'DESYNC_DETECTED':
          // Treat a server-confirmed desync as a hard end of match;
          // M3c will reroute this through a more graceful UI.
          this.fireEnd(null);
          break;
        default:
          break;
      }
    });
  }

  submitInput(currentFrame: Frame, actions: readonly InputAction[]): void {
    if (this.disposed) return;
    // Apply locally with `inputDelay` lookahead. The server tags the
    // batch with the same frame, so when the simulator reaches it the
    // input pulls back in along with every other player's actions.
    const targetFrame = currentFrame + this.inputDelay;
    this.room.send('INPUT', { frame: targetFrame, actions: [...actions] });
  }

  getInputBatch(frame: Frame): InputBatch | null {
    const batch = this.pendingBatches.get(frame);
    if (!batch) return null;
    this.pendingBatches.delete(frame);

    // Submit a hash check on the cadence requested. We do it here
    // (post-batch, pre-advance) so the hash is on a fully-settled
    // state shared across everyone.
    if (frame > 0 && frame % this.hashEveryFrames === 0) {
      try {
        this.room.send('STATE_HASH', { frame, hash: computeHash(this.match) });
      } catch {
        /* ignore; hash submission is best-effort */
      }
    }
    return batch;
  }

  onMatchEnd(fn: (winnerId: PlayerId | null) => void): void {
    this.endHandlers.push(fn);
  }

  dispose(): void {
    this.disposed = true;
    this.pendingBatches.clear();
    this.endHandlers.length = 0;
  }

  // ----------------------------------------------------------------

  private emptyBatch(playerOrder: readonly PlayerId[]): InputBatch {
    const out: InputBatch = {};
    for (const id of playerOrder) out[id] = [];
    return out;
  }

  private fireEnd(winnerId: PlayerId | null): void {
    if (this.endFired) return;
    this.endFired = true;
    for (const fn of this.endHandlers) fn(winnerId);
  }
}
