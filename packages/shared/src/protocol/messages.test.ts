import { describe, expect, it } from 'vitest';
import { lobbyC2S, lobbyS2C, matchC2S, matchS2C } from './messages';

describe('lobby C2S', () => {
  it('accepts JOIN_LOBBY with a valid nickname', () => {
    const r = lobbyC2S.safeParse({ t: 'JOIN_LOBBY', nickname: 'alice' });
    expect(r.success).toBe(true);
  });

  it('rejects JOIN_LOBBY with an empty nickname', () => {
    const r = lobbyC2S.safeParse({ t: 'JOIN_LOBBY', nickname: '' });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown discriminator', () => {
    const r = lobbyC2S.safeParse({ t: 'NOPE' });
    expect(r.success).toBe(false);
  });

  it('CREATE_ROOM requires a valid capacity', () => {
    expect(
      lobbyC2S.safeParse({ t: 'CREATE_ROOM', capacity: 2, colorMode: 4, isPrivate: false }).success,
    ).toBe(true);
    // capacity 5 is not in the allowed union
    expect(
      lobbyC2S.safeParse({ t: 'CREATE_ROOM', capacity: 5, colorMode: 4, isPrivate: false }).success,
    ).toBe(false);
  });
});

describe('lobby S2C', () => {
  it('LOBBY_STATE carries a room array', () => {
    const r = lobbyS2C.safeParse({
      t: 'LOBBY_STATE',
      rooms: [
        {
          roomId: 'r_1',
          name: 'A',
          capacity: 2,
          colorMode: 4,
          players: 1,
          isPrivate: false,
          status: 'lobby',
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('JOIN_ROOM_REJECTED enumerates known reasons', () => {
    expect(lobbyS2C.safeParse({ t: 'JOIN_ROOM_REJECTED', reason: 'FULL' }).success).toBe(true);
    expect(lobbyS2C.safeParse({ t: 'JOIN_ROOM_REJECTED', reason: 'WAT' }).success).toBe(false);
  });
});

describe('match C2S', () => {
  it('INPUT accepts an action list', () => {
    const r = matchC2S.safeParse({ t: 'INPUT', frame: 0, actions: ['MOVE_L', 'ROT_R'] });
    expect(r.success).toBe(true);
  });

  it('INPUT rejects an unknown action', () => {
    const r = matchC2S.safeParse({ t: 'INPUT', frame: 0, actions: ['JUMP'] });
    expect(r.success).toBe(false);
  });

  it('STATE_HASH requires a non-negative frame', () => {
    expect(matchC2S.safeParse({ t: 'STATE_HASH', frame: 0, hash: 'abc' }).success).toBe(true);
    expect(matchC2S.safeParse({ t: 'STATE_HASH', frame: -1, hash: 'abc' }).success).toBe(false);
  });
});

describe('match S2C', () => {
  it('MATCH_START carries a drop queue of color pairs', () => {
    const r = matchS2C.safeParse({
      t: 'MATCH_START',
      seed: 42,
      dropQueue: [
        ['R', 'G'],
        ['B', 'Y'],
      ],
      playerOrder: ['p_a', 'p_b'],
      startFrameMs: 1_000_000,
    });
    expect(r.success).toBe(true);
  });

  it('COUNTDOWN_START pins durationFrames to 180', () => {
    expect(
      matchS2C.safeParse({ t: 'COUNTDOWN_START', durationFrames: 180, serverStartMs: 0 }).success,
    ).toBe(true);
    expect(
      matchS2C.safeParse({ t: 'COUNTDOWN_START', durationFrames: 120, serverStartMs: 0 }).success,
    ).toBe(false);
  });

  it('MATCH_ROOM_STATE includes status', () => {
    const r = matchS2C.safeParse({
      t: 'MATCH_ROOM_STATE',
      players: [
        {
          playerId: 'p_a',
          nickname: 'A',
          characterId: 'c1',
          slotIndex: 0,
          ready: true,
          connected: true,
        },
      ],
      config: { capacity: 2, colorMode: 4, isPrivate: false },
      status: 'lobby',
    });
    expect(r.success).toBe(true);
  });
});
