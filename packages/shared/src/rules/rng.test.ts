import { describe, expect, it } from 'vitest';
import { Xorshift32 } from './rng';

describe('Xorshift32', () => {
  describe('determinism', () => {
    it('produces identical sequences for identical seeds', () => {
      const a = new Xorshift32(12345);
      const b = new Xorshift32(12345);
      const seqA = Array.from({ length: 20 }, () => a.next());
      const seqB = Array.from({ length: 20 }, () => b.next());
      expect(seqA).toEqual(seqB);
    });

    it('produces different sequences for different seeds', () => {
      const a = new Xorshift32(1);
      const b = new Xorshift32(2);
      const seqA = Array.from({ length: 10 }, () => a.next());
      const seqB = Array.from({ length: 10 }, () => b.next());
      expect(seqA).not.toEqual(seqB);
    });

    it('handles a zero seed without producing all zeros', () => {
      const rng = new Xorshift32(0);
      const values = Array.from({ length: 10 }, () => rng.next());
      expect(values.every((v) => v === 0)).toBe(false);
    });
  });

  describe('nextInt', () => {
    it('returns values in [0, max)', () => {
      const rng = new Xorshift32(42);
      for (let i = 0; i < 200; i++) {
        const v = rng.nextInt(6);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(6);
        expect(Number.isInteger(v)).toBe(true);
      }
    });

    it('covers the full range over many draws', () => {
      const rng = new Xorshift32(7);
      const seen = new Set<number>();
      for (let i = 0; i < 500; i++) seen.add(rng.nextInt(6));
      expect(seen.size).toBe(6);
    });

    it('rejects non-positive max', () => {
      const rng = new Xorshift32(1);
      expect(() => rng.nextInt(0)).toThrow();
      expect(() => rng.nextInt(-1)).toThrow();
    });
  });

  describe('nextFloat', () => {
    it('returns values in [0, 1)', () => {
      const rng = new Xorshift32(99);
      for (let i = 0; i < 200; i++) {
        const v = rng.nextFloat();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('sampleIndices', () => {
    it('returns exactly k distinct indices', () => {
      const rng = new Xorshift32(11);
      const out = rng.sampleIndices(6, 3);
      expect(out).toHaveLength(3);
      expect(new Set(out).size).toBe(3);
      for (const i of out) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(6);
      }
    });

    it('is deterministic for the same state', () => {
      const a = new Xorshift32(11);
      const b = new Xorshift32(11);
      expect(a.sampleIndices(6, 3)).toEqual(b.sampleIndices(6, 3));
    });

    it('supports k=0 and k=n edge cases', () => {
      const rng = new Xorshift32(1);
      expect(rng.sampleIndices(6, 0)).toEqual([]);
      const all = new Xorshift32(1).sampleIndices(6, 6);
      expect(new Set(all)).toEqual(new Set([0, 1, 2, 3, 4, 5]));
    });

    it('rejects k out of range', () => {
      const rng = new Xorshift32(1);
      expect(() => rng.sampleIndices(3, 5)).toThrow();
      expect(() => rng.sampleIndices(3, -1)).toThrow();
    });
  });

  describe('state snapshot', () => {
    it('restores the same sequence after setState', () => {
      const a = new Xorshift32(99);
      a.next();
      a.next();
      const snapshot = a.getState();

      const b = new Xorshift32(1);
      b.setState(snapshot);

      expect(a.next()).toBe(b.next());
      expect(a.next()).toBe(b.next());
    });

    it('clone() produces an independent rng with identical sequence', () => {
      const a = new Xorshift32(55);
      a.next();
      const b = a.clone();
      const seqA = [a.next(), a.next(), a.next()];
      const seqB = [b.next(), b.next(), b.next()];
      expect(seqA).toEqual(seqB);
      // Advancing one does not affect the other
      a.next();
      expect(b.getState()).not.toBe(a.getState());
    });
  });
});
