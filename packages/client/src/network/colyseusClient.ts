/**
 * Shared Colyseus client and small helpers used by the lobby and match
 * scenes. See D4 §2 and D5 §6.
 *
 * The websocket URL comes from `VITE_SERVER_URL` (see `.env.example`).
 * For local dev that's `ws://localhost:2567`; in production it points
 * at the deployed Fly.io / equivalent host.
 */

import { type LobbyS2C, type MatchS2C, lobbyS2C, matchS2C } from '@chaindrop/shared/protocol';
import { Client, type Room } from 'colyseus.js';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:2567';

export const colyseus = new Client(SERVER_URL);

export type LobbyRoomHandle = Room<unknown>;
export type MatchRoomHandle = Room<unknown>;

/**
 * Subscribe to every known message type on a room and forward parsed,
 * validated payloads to a single handler. Anything that fails to parse
 * is logged and dropped — never thrown — so a buggy server can't take
 * down the client scene.
 */
export function onLobbyMessage(room: LobbyRoomHandle, handler: (msg: LobbyS2C) => void): void {
  const types: LobbyS2C['t'][] = [
    'LOBBY_JOINED',
    'LOBBY_STATE',
    'ROOM_CREATED',
    'JOIN_ROOM_OK',
    'JOIN_ROOM_REJECTED',
    'QUICK_MATCH_FOUND',
    'ERROR',
  ];
  for (const t of types) {
    room.onMessage(t, (raw: unknown) => {
      const parsed = lobbyS2C.safeParse({
        t,
        ...(typeof raw === 'object' && raw !== null ? raw : {}),
      });
      if (!parsed.success) {
        console.warn('[lobby] dropped malformed', t, parsed.error.issues);
        return;
      }
      handler(parsed.data);
    });
  }
}

export function onMatchMessage(room: MatchRoomHandle, handler: (msg: MatchS2C) => void): void {
  const types: MatchS2C['t'][] = [
    'MATCH_ROOM_STATE',
    'COUNTDOWN_START',
    'COUNTDOWN_CANCEL',
    'MATCH_START',
    'MATCH_BEGIN',
    'INPUT_BATCH',
    'PLAYER_ELIMINATED',
    'PLAYER_DISCONNECTED',
    'PLAYER_RECONNECTED',
    'MATCH_END',
    'DESYNC_DETECTED',
    'PONG',
    'ERROR',
  ];
  for (const t of types) {
    room.onMessage(t, (raw: unknown) => {
      const parsed = matchS2C.safeParse({
        t,
        ...(typeof raw === 'object' && raw !== null ? raw : {}),
      });
      if (!parsed.success) {
        console.warn('[match] dropped malformed', t, parsed.error.issues);
        return;
      }
      handler(parsed.data);
    });
  }
}
