import { describe, expect, it } from 'vitest';
import type { Cluster } from './cluster';
import {
  MAX_CHAIN_BONUS,
  calculateChainScore,
  chainBonus,
  colorBonus,
  computeMultiplier,
  connectionBonusOfCluster,
  connectionBonusTotal,
  countUniqueColors,
  totalPopCount,
} from './score';

/** Build a cluster stub with just `color` and `size` — cells are unused. */
function cluster(color: Cluster['color'], size: number): Cluster {
  return { color, size, cells: [] };
}

describe('chainBonus (D3 §2, tests TS-01..TS-04)', () => {
  it('TS-01 chain 1 → 0', () => {
    expect(chainBonus(1)).toBe(0);
  });
  it('doubling progression for chains 2..4', () => {
    expect(chainBonus(2)).toBe(8);
    expect(chainBonus(3)).toBe(16);
    expect(chainBonus(4)).toBe(32);
  });
  it('TS-02 chain 5 → 64, then +32 per chain', () => {
    expect(chainBonus(5)).toBe(64);
    expect(chainBonus(6)).toBe(96);
    expect(chainBonus(7)).toBe(128);
    expect(chainBonus(10)).toBe(224);
    expect(chainBonus(15)).toBe(384);
  });
  it('TS-03 chain 19 → 512', () => {
    expect(chainBonus(19)).toBe(MAX_CHAIN_BONUS);
  });
  it('TS-04 cap at 512 for chains ≥ 19', () => {
    expect(chainBonus(20)).toBe(512);
    expect(chainBonus(25)).toBe(512);
    expect(chainBonus(999)).toBe(512);
  });
});

describe('connectionBonusOfCluster (D3 §3, tests TS-05..TS-07)', () => {
  it('TS-05 size 4 → 0', () => {
    expect(connectionBonusOfCluster(4)).toBe(0);
  });
  it('sizes 5..10 follow the spec table', () => {
    expect(connectionBonusOfCluster(5)).toBe(2);
    expect(connectionBonusOfCluster(6)).toBe(3);
    expect(connectionBonusOfCluster(7)).toBe(4);
    expect(connectionBonusOfCluster(8)).toBe(5);
    expect(connectionBonusOfCluster(9)).toBe(6);
    expect(connectionBonusOfCluster(10)).toBe(7);
  });
  it('TS-06 size 11 → 10 (cap)', () => {
    expect(connectionBonusOfCluster(11)).toBe(10);
  });
  it('TS-07 size 20 → 10 (still capped)', () => {
    expect(connectionBonusOfCluster(20)).toBe(10);
  });
  it('returns 0 for subthreshold sizes', () => {
    expect(connectionBonusOfCluster(0)).toBe(0);
    expect(connectionBonusOfCluster(1)).toBe(0);
    expect(connectionBonusOfCluster(3)).toBe(0);
  });
});

describe('connectionBonusTotal', () => {
  it('sums contributions across every cluster', () => {
    const clusters = [cluster('R', 5), cluster('B', 6)]; // 2 + 3 = 5
    expect(connectionBonusTotal(clusters)).toBe(5);
  });
  it('zero for all size-4 clusters', () => {
    const clusters = [cluster('R', 4), cluster('G', 4), cluster('B', 4)];
    expect(connectionBonusTotal(clusters)).toBe(0);
  });
  it('empty list → 0', () => {
    expect(connectionBonusTotal([])).toBe(0);
  });
});

describe('colorBonus (D3 §4, tests TS-08..TS-09)', () => {
  it('TS-08 1 color → 0', () => {
    expect(colorBonus(1)).toBe(0);
  });
  it('2..4 colors follow table', () => {
    expect(colorBonus(2)).toBe(3);
    expect(colorBonus(3)).toBe(6);
    expect(colorBonus(4)).toBe(12);
  });
  it('TS-09 5 colors → 24', () => {
    expect(colorBonus(5)).toBe(24);
  });
  it('returns 0 for 0 colors', () => {
    expect(colorBonus(0)).toBe(0);
  });
});

describe('countUniqueColors', () => {
  it('deduplicates colors across clusters', () => {
    const clusters = [cluster('R', 4), cluster('R', 5), cluster('B', 4)];
    expect(countUniqueColors(clusters)).toBe(2);
  });
});

describe('totalPopCount', () => {
  it('sums cluster sizes', () => {
    expect(totalPopCount([cluster('R', 4), cluster('B', 5)])).toBe(9);
  });
});

describe('computeMultiplier — clamps to at least 1', () => {
  it('1-chain single 4-cluster of one color yields multiplier 1', () => {
    expect(computeMultiplier(1, [cluster('R', 4)])).toBe(1);
  });
});

describe('calculateChainScore (D3 §10, integration tests TSI-01..TSI-05)', () => {
  it('TSI-01 single 1-chain 4-cluster of one color → 40', () => {
    expect(calculateChainScore(1, [cluster('R', 4)])).toBe(40);
  });

  it('TSI-02 single 1-chain 5-cluster of one color → 100', () => {
    expect(calculateChainScore(1, [cluster('R', 5)])).toBe(100);
  });

  it('TSI-03 two-color simultaneous pop (R4 + B4), chain 1 → 240', () => {
    // popCount=8, chainBonus=0, connection=0, colorBonus=3, mult=3 → 10*8*3
    expect(calculateChainScore(1, [cluster('R', 4), cluster('B', 4)])).toBe(240);
  });

  it('TSI-04 5th chain of a single 4-cluster → 2560', () => {
    // chainBonus(5)=64, mult=64 → 10*4*64
    expect(calculateChainScore(5, [cluster('R', 4)])).toBe(2560);
  });

  it('TSI-05 3-color simultaneous pop on chain 4 (three 4-clusters) → 4560', () => {
    // popCount=12, chainBonus(4)=32, connection=0, colorBonus(3)=6, mult=38
    // 10 * 12 * 38 = 4560
    const clusters = [cluster('R', 4), cluster('G', 4), cluster('B', 4)];
    expect(calculateChainScore(4, clusters)).toBe(4560);
  });

  it('reproduces the D3 §10 5-chain walkthrough', () => {
    // Each chain: 4-cell single-color cluster.
    const rows = [
      { chain: 1, mult: 1, score: 40 },
      { chain: 2, mult: 8, score: 320 },
      { chain: 3, mult: 16, score: 640 },
      { chain: 4, mult: 32, score: 1280 },
      { chain: 5, mult: 64, score: 2560 },
    ];
    for (const row of rows) {
      const s = calculateChainScore(row.chain, [cluster('R', 4)]);
      expect(s).toBe(row.score);
    }
    const total = rows.reduce((sum, r) => sum + r.score, 0);
    expect(total).toBe(4840);
  });
});

describe('score output bounds', () => {
  it('is always a non-negative integer', () => {
    for (const chain of [1, 5, 10, 19, 25]) {
      for (const size of [4, 5, 8, 11, 20]) {
        const s = calculateChainScore(chain, [cluster('R', size)]);
        expect(Number.isInteger(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
