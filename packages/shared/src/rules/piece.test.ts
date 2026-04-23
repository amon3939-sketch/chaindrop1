import { describe, expect, it } from 'vitest';
import {
  SPAWN_AXIS_X,
  SPAWN_AXIS_Y,
  SPAWN_CHILD_X,
  SPAWN_CHILD_Y,
  childOffset,
  createPiece,
  getChildPos,
  rotateCCW,
  rotateCW,
  withPiece,
} from './piece';

describe('childOffset', () => {
  it('returns the spec offsets for each rotation', () => {
    expect(childOffset(0)).toEqual([0, -1]);
    expect(childOffset(1)).toEqual([-1, 0]);
    expect(childOffset(2)).toEqual([0, 1]);
    expect(childOffset(3)).toEqual([1, 0]);
  });
});

describe('createPiece', () => {
  it('places axis at the spawn position with rotation=0', () => {
    const p = createPiece(['R', 'G']);
    expect(p.axisX).toBe(SPAWN_AXIS_X);
    expect(p.axisY).toBe(SPAWN_AXIS_Y);
    expect(p.rotation).toBe(0);
    expect(p.colors).toEqual(['R', 'G']);
  });

  it('puts the child at the spawn child position with default rotation', () => {
    const p = createPiece(['R', 'G']);
    const [cx, cy] = getChildPos(p);
    expect(cx).toBe(SPAWN_CHILD_X);
    expect(cy).toBe(SPAWN_CHILD_Y);
  });
});

describe('getChildPos', () => {
  it('computes all four rotations around the axis', () => {
    const axis = createPiece(['R', 'G']);
    expect(getChildPos({ ...axis, rotation: 0 })).toEqual([SPAWN_AXIS_X, SPAWN_AXIS_Y - 1]);
    expect(getChildPos({ ...axis, rotation: 1 })).toEqual([SPAWN_AXIS_X - 1, SPAWN_AXIS_Y]);
    expect(getChildPos({ ...axis, rotation: 2 })).toEqual([SPAWN_AXIS_X, SPAWN_AXIS_Y + 1]);
    expect(getChildPos({ ...axis, rotation: 3 })).toEqual([SPAWN_AXIS_X + 1, SPAWN_AXIS_Y]);
  });
});

describe('rotateCW / rotateCCW', () => {
  it('CW advances 0 → 1 → 2 → 3 → 0', () => {
    expect(rotateCW(0)).toBe(1);
    expect(rotateCW(1)).toBe(2);
    expect(rotateCW(2)).toBe(3);
    expect(rotateCW(3)).toBe(0);
  });

  it('CCW advances 0 → 3 → 2 → 1 → 0', () => {
    expect(rotateCCW(0)).toBe(3);
    expect(rotateCCW(3)).toBe(2);
    expect(rotateCCW(2)).toBe(1);
    expect(rotateCCW(1)).toBe(0);
  });

  it('CW and CCW are inverses', () => {
    for (const r of [0, 1, 2, 3] as const) {
      expect(rotateCCW(rotateCW(r))).toBe(r);
      expect(rotateCW(rotateCCW(r))).toBe(r);
    }
  });
});

describe('withPiece', () => {
  it('does not mutate the original', () => {
    const p = createPiece(['R', 'G']);
    const p2 = withPiece(p, { axisX: 0 });
    expect(p.axisX).toBe(SPAWN_AXIS_X);
    expect(p2.axisX).toBe(0);
    expect(p2.axisY).toBe(p.axisY);
    expect(p2.rotation).toBe(p.rotation);
    expect(p2.colors).toBe(p.colors);
  });

  it('overrides only provided fields', () => {
    const p = createPiece(['R', 'G']);
    const p2 = withPiece(p, { rotation: 2 });
    expect(p2.rotation).toBe(2);
    expect(p2.axisX).toBe(p.axisX);
  });
});
