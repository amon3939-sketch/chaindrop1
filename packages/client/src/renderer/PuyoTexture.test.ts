import { describe, expect, it } from 'vitest';
import { connectionsToRow } from './PuyoTexture';

describe('connectionsToRow', () => {
  it('returns row 0 when no connections', () => {
    expect(connectionsToRow({ up: false, down: false, left: false, right: false })).toBe(0);
    expect(connectionsToRow(undefined)).toBe(0);
  });

  it('maps single-direction connections to their rows', () => {
    expect(connectionsToRow({ up: true, down: false, left: false, right: false })).toBe(1);
    expect(connectionsToRow({ up: false, down: true, left: false, right: false })).toBe(2);
    expect(connectionsToRow({ up: false, down: false, left: true, right: false })).toBe(4);
    expect(connectionsToRow({ up: false, down: false, left: false, right: true })).toBe(8);
  });

  it('maps combined connections correctly', () => {
    expect(connectionsToRow({ up: true, down: true, left: false, right: false })).toBe(3);
    expect(connectionsToRow({ up: true, down: false, left: true, right: false })).toBe(5);
    expect(connectionsToRow({ up: false, down: true, left: true, right: false })).toBe(6);
    expect(connectionsToRow({ up: true, down: true, left: true, right: false })).toBe(7);
    expect(connectionsToRow({ up: true, down: false, left: false, right: true })).toBe(9);
    expect(connectionsToRow({ up: false, down: true, left: false, right: true })).toBe(10);
    expect(connectionsToRow({ up: true, down: true, left: false, right: true })).toBe(11);
    expect(connectionsToRow({ up: false, down: false, left: true, right: true })).toBe(12);
    expect(connectionsToRow({ up: true, down: false, left: true, right: true })).toBe(13);
    expect(connectionsToRow({ up: false, down: true, left: true, right: true })).toBe(14);
    expect(connectionsToRow({ up: true, down: true, left: true, right: true })).toBe(15);
  });
});
