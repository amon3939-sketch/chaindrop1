/**
 * HashChecker — collects per-frame STATE_HASH submissions from every
 * player in a match and surfaces a desync the instant the set of
 * unique hashes for a frame is greater than one.
 *
 * See D4 §4.3 and D6 §8.
 */

import type { PlayerId } from '@chaindrop/shared/protocol';

export interface HashCheckerOptions {
  playerOrder: readonly PlayerId[];
  onMismatch: (frame: number, hashes: Record<PlayerId, string>) => void;
}

export class HashChecker {
  private buffer = new Map<number, Map<PlayerId, string>>();
  private readonly playerSet: ReadonlySet<PlayerId>;

  constructor(private readonly opts: HashCheckerOptions) {
    this.playerSet = new Set(opts.playerOrder);
  }

  submit(playerId: PlayerId, frame: number, hash: string): void {
    if (!this.playerSet.has(playerId)) return;
    let bucket = this.buffer.get(frame);
    if (!bucket) {
      bucket = new Map();
      this.buffer.set(frame, bucket);
    }
    bucket.set(playerId, hash);
    if (bucket.size !== this.playerSet.size) return;

    const hashes: Record<PlayerId, string> = {};
    for (const [pid, h] of bucket) hashes[pid] = h;
    this.buffer.delete(frame);

    const unique = new Set(Object.values(hashes));
    if (unique.size > 1) this.opts.onMismatch(frame, hashes);
  }

  dispose(): void {
    this.buffer.clear();
  }
}
