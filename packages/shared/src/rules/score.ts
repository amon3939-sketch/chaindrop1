/**
 * Chain score calculation per D3.
 *
 *   chainScore = 10 × popCount × max(1, chainBonus + connectionBonus + colorBonus)
 *
 * All functions are pure — no I/O, no state. The score produced here
 * is fed into `garbage.ts` for the ojama conversion (rate = 70).
 */

import type { Cluster } from './cluster';

/** Upper bound on the chain bonus (reached at 19 chains and beyond). */
export const MAX_CHAIN_BONUS = 512;

/**
 * Chain bonus table (see D3 §2).
 *
 *   chain:  1  2  3  4  5  6  7  ... 19 20+
 *   bonus:  0  8 16 32 64 96 128 ... 512 512
 *
 * Doubling 8→16→32 for chains 2..4, then +32 per chain from chain 5,
 * capped at 512.
 */
export function chainBonus(chain: number): number {
  if (chain <= 1) return 0;
  if (chain === 2) return 8;
  if (chain === 3) return 16;
  if (chain === 4) return 32;
  return Math.min(64 + (chain - 5) * 32, MAX_CHAIN_BONUS);
}

/** Bonus contributed by a single cluster's size (D3 §3). */
export function connectionBonusOfCluster(size: number): number {
  if (size < 4) return 0;
  if (size >= 11) return 10;
  // size ∈ [4, 10]
  const table = [0, 2, 3, 4, 5, 6, 7] as const;
  return table[size - 4] as number;
}

/** Sum of `connectionBonusOfCluster` across every cluster that popped. */
export function connectionBonusTotal(clusters: readonly Cluster[]): number {
  let sum = 0;
  for (const c of clusters) sum += connectionBonusOfCluster(c.size);
  return sum;
}

/**
 * Color bonus table (D3 §4).
 *
 *   colors:  1  2  3  4  5
 *   bonus:   0  3  6 12 24
 */
export function colorBonus(colorsCount: number): number {
  if (colorsCount <= 1) return 0;
  if (colorsCount === 2) return 3;
  if (colorsCount === 3) return 6;
  if (colorsCount === 4) return 12;
  return 24;
}

/** Count the distinct normal colors across a set of clusters. */
export function countUniqueColors(clusters: readonly Cluster[]): number {
  const colors = new Set<string>();
  for (const c of clusters) colors.add(c.color);
  return colors.size;
}

/** Sum of cluster sizes = total normal puyos that popped this tick. */
export function totalPopCount(clusters: readonly Cluster[]): number {
  let sum = 0;
  for (const c of clusters) sum += c.size;
  return sum;
}

/**
 * Combined multiplier, clamped to 1 so that a trivial 1-chain 4-cluster
 * still scores something.
 */
export function computeMultiplier(chainIndex: number, clusters: readonly Cluster[]): number {
  const cb = chainBonus(chainIndex);
  const conn = connectionBonusTotal(clusters);
  const col = colorBonus(countUniqueColors(clusters));
  return Math.max(1, cb + conn + col);
}

/**
 * Final score awarded for a single chain tick. See D3 §1.
 *
 * `clusters` must be the set of NORMAL-color clusters that popped this
 * tick. Ojama cells that were swept up as collateral are ignored here
 * (they do not contribute to `popCount` per the spec).
 */
export function calculateChainScore(chainIndex: number, clusters: readonly Cluster[]): number {
  return 10 * totalPopCount(clusters) * computeMultiplier(chainIndex, clusters);
}
