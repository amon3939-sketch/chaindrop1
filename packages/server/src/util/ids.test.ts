import { describe, expect, it } from 'vitest';
import { randomId, randomJoinCode } from './ids';

describe('randomId', () => {
  it('honours the prefix and length', () => {
    const id = randomId('r_', 6);
    expect(id.startsWith('r_')).toBe(true);
    expect(id.length).toBe(2 + 6);
  });

  it('only uses unambiguous characters', () => {
    // Generate a handful and confirm none contain banned look-alikes.
    const banned = /[01iloIO]/;
    for (let i = 0; i < 50; i++) {
      const body = randomId('p_', 8).slice(2);
      expect(banned.test(body)).toBe(false);
    }
  });

  it('produces enough variation to make collisions unlikely', () => {
    // Sanity check: 200 generated ids should be unique on a 32-char,
    // length-6 alphabet (32^6 ≈ 1B keys → birthday bound is ~32k).
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(randomId('r_', 6));
    expect(seen.size).toBe(200);
  });
});

describe('randomJoinCode', () => {
  it('respects the requested length and the safe alphabet', () => {
    const code = randomJoinCode(4);
    expect(code.length).toBe(4);
    expect(/[01iloIO]/.test(code)).toBe(false);
  });
});
