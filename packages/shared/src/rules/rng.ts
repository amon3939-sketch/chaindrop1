/**
 * Deterministic RNG based on xorshift32.
 *
 * Used everywhere the game needs a "random" decision that must still
 * match across clients in a lockstep match (ojama redistribution,
 * drop queue generation, etc.). See D1 §3.3.
 *
 * The state is a single 32-bit integer. Every call mutates it in place
 * and returns the new value.
 */

const MASK = 0xffffffff;

export class Xorshift32 {
  private state: number;

  constructor(seed: number) {
    // State must be non-zero. Fold seed through a mixing step so that
    // 0 or tiny seeds still produce a well-distributed sequence.
    let s = (seed | 0) === 0 ? 0x9e3779b9 : seed | 0;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.state = s >>> 0 || 1;
  }

  /** Advance the state and return the raw 32-bit value (unsigned). */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x &= MASK;
    x ^= x >>> 17;
    x ^= x << 5;
    x &= MASK;
    this.state = x >>> 0;
    return this.state;
  }

  /** Integer in the half-open range [0, max). */
  nextInt(max: number): number {
    if (max <= 0 || !Number.isInteger(max)) {
      throw new RangeError(`nextInt: max must be a positive integer, got ${max}`);
    }
    // Rejection sampling to avoid modulo bias. `limit` is kept as a regular
    // number (up to 2^32) and NOT truncated to uint32 — truncation would
    // wrap 2^32 back to 0 and cause an infinite loop when `max` divides 2^32.
    const limit = 0x100000000 - (0x100000000 % max);
    while (true) {
      const r = this.next();
      if (r < limit) return r % max;
    }
  }

  /** Float in [0, 1). */
  nextFloat(): number {
    return this.next() / 0x100000000;
  }

  /**
   * Pick `k` distinct indices from [0, n) using Fisher-Yates partial shuffle.
   * Deterministic and order-stable for a given state.
   */
  sampleIndices(n: number, k: number): number[] {
    if (k < 0 || k > n) {
      throw new RangeError(`sampleIndices: k=${k} out of range for n=${n}`);
    }
    const pool = Array.from({ length: n }, (_, i) => i);
    for (let i = 0; i < k; i++) {
      const j = i + this.nextInt(n - i);
      const tmp = pool[i] as number;
      pool[i] = pool[j] as number;
      pool[j] = tmp;
    }
    return pool.slice(0, k);
  }

  /** Current internal state. Useful for snapshotting/restoring. */
  getState(): number {
    return this.state;
  }

  /** Restore a previously captured state. */
  setState(state: number): void {
    this.state = state >>> 0 || 1;
  }

  /** Create a detached RNG with the same state. */
  clone(): Xorshift32 {
    const r = new Xorshift32(1);
    r.setState(this.state);
    return r;
  }
}
