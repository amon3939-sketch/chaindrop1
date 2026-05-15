/**
 * InputRelay — server-side glue for deterministic lockstep play.
 *
 * Holds a per-frame buffer of `INPUT` actions submitted by each player
 * in the match. As soon as every expected player's input for a frame
 * has arrived, the relay emits an `INPUT_BATCH` and advances the
 * cursor. If a frame stays partial for `flushTimeoutMs`, the missing
 * players are filled in with empty input lists so the match never
 * stalls indefinitely.
 *
 * See D4 §4 and D6 §7.
 */

import type { InputAction, PlayerId } from '@chaindrop/shared/protocol';

export interface InputRelayOptions {
  playerOrder: readonly PlayerId[];
  /** Milliseconds to wait for stragglers before force-flushing a frame. */
  flushTimeoutMs?: number;
  /** Frames a player can miss in a row before we signal a timeout. */
  missThreshold?: number;
  onBatchReady: (frame: number, inputs: Record<PlayerId, InputAction[]>) => void;
  onPlayerTimeout: (playerId: PlayerId) => void;
}

const DEFAULT_FLUSH_TIMEOUT_MS = 200;
const DEFAULT_MISS_THRESHOLD = 30;

export class InputRelay {
  private buffers = new Map<number, Map<PlayerId, InputAction[]>>();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private missCounts = new Map<PlayerId, number>();
  /**
   * Lowest frame number we have NOT yet flushed. Late submissions for
   * frames that already flushed are dropped silently — by the time the
   * server has fired INPUT_BATCH the clients have already committed.
   */
  private nextPendingFrame = 0;
  private disposed = false;
  private readonly playerSet: ReadonlySet<PlayerId>;

  constructor(private readonly opts: InputRelayOptions) {
    this.playerSet = new Set(opts.playerOrder);
  }

  submit(playerId: PlayerId, frame: number, actions: InputAction[]): void {
    if (this.disposed) return;
    if (!this.playerSet.has(playerId)) return;
    if (frame < this.nextPendingFrame) return;

    let bucket = this.buffers.get(frame);
    if (!bucket) {
      bucket = new Map();
      this.buffers.set(frame, bucket);
      const timeoutMs = this.opts.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;
      this.timers.set(
        frame,
        setTimeout(() => this.forceFlush(frame), timeoutMs),
      );
    }
    if (bucket.has(playerId)) return; // duplicate; first write wins.
    bucket.set(playerId, actions);
    if (bucket.size === this.playerSet.size) this.flush(frame);
  }

  /**
   * Flush every still-buffered frame (e.g. when the match ends or the
   * room disposes). Pending timers are cleared without firing.
   */
  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.buffers.clear();
    this.missCounts.clear();
  }

  // ----------------------------------------------------------------

  private forceFlush(frame: number): void {
    if (this.disposed) return;
    if (!this.buffers.has(frame)) return;
    this.flush(frame);
  }

  private flush(frame: number): void {
    const bucket = this.buffers.get(frame);
    if (!bucket) return;
    const timer = this.timers.get(frame);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(frame);
    }
    this.buffers.delete(frame);

    const out: Record<PlayerId, InputAction[]> = {};
    for (const pid of this.opts.playerOrder) {
      const arrived = bucket.get(pid);
      if (arrived === undefined) {
        out[pid] = [];
        this.bumpMiss(pid);
      } else {
        out[pid] = arrived;
        this.missCounts.set(pid, 0);
      }
    }

    if (frame >= this.nextPendingFrame) this.nextPendingFrame = frame + 1;
    this.opts.onBatchReady(frame, out);
  }

  private bumpMiss(pid: PlayerId): void {
    const threshold = this.opts.missThreshold ?? DEFAULT_MISS_THRESHOLD;
    const n = (this.missCounts.get(pid) ?? 0) + 1;
    this.missCounts.set(pid, n);
    if (n >= threshold) {
      this.opts.onPlayerTimeout(pid);
      this.missCounts.set(pid, 0);
    }
  }
}
