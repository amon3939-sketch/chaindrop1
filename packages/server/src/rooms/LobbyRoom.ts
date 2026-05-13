/**
 * LobbyRoom — the persistent hub clients enter before joining a match.
 *
 * Responsibilities (M3a scope):
 *   - Broadcast the current room list to subscribed clients.
 *   - Accept `CREATE_ROOM` and provision a new MatchRoom via the
 *     Colyseus matchmaker.
 *   - Accept `JOIN_ROOM` and return the MatchRoom id for the client to
 *     connect to.
 *
 * `QUICK_MATCH` (matchmaking queue) and `CANCEL_QUICK_MATCH` are
 * accepted with a placeholder rejection — full matchmaking lands in
 * M3c. See D6 §5.
 */

import { type LobbyC2S, lobbyC2S } from '@chaindrop/shared/protocol';
import { type Client, Room, matchMaker } from '@colyseus/core';
import { config } from '../config';
import { randomId, randomJoinCode } from '../util/ids';
import { lobbyBus } from '../util/lobbyBus';
import { logger } from '../util/logger';
import { sanitizeNickname } from '../util/sanitize';
import { LobbyState, RoomSummarySchema } from './state';

interface JoinedClient {
  nickname: string;
}

export class LobbyRoom extends Room<LobbyState> {
  override maxClients = 200;
  private clientNicknames = new Map<string, JoinedClient>();

  override onCreate(): void {
    this.setState(new LobbyState());
    // 500ms patch rate is enough for room-list updates; the lobby
    // doesn't carry time-sensitive state.
    this.setPatchRate(500);

    this.onMessage('*', (client, type, message) => this.handle(client, type, message));

    lobbyBus.on('room:created', (summary) => {
      const row = new RoomSummarySchema().assign(summary);
      this.state.rooms.set(summary.roomId, row);
    });
    lobbyBus.on('room:update', (summary) => {
      const row = this.state.rooms.get(summary.roomId);
      if (row) row.assign(summary);
    });
    lobbyBus.on('room:removed', (roomId) => {
      this.state.rooms.delete(roomId);
    });

    logger.info('LobbyRoom created');
  }

  override onJoin(client: Client): void {
    // The client must follow up with JOIN_LOBBY (carrying nickname) to
    // be considered "in" the lobby; until then we just hold the slot.
    this.clientNicknames.set(client.sessionId, { nickname: '' });
    logger.info({ sessionId: client.sessionId }, 'lobby join');
  }

  override onLeave(client: Client): void {
    this.clientNicknames.delete(client.sessionId);
    logger.info({ sessionId: client.sessionId }, 'lobby leave');
  }

  // ----------------------------------------------------------------

  private handle(client: Client, type: string | number, raw: unknown): void {
    const parsed = lobbyC2S.safeParse({
      t: type,
      ...(typeof raw === 'object' && raw !== null ? raw : {}),
    });
    if (!parsed.success) {
      client.send('ERROR', {
        code: 'BAD_MESSAGE',
        message: `unknown or malformed ${String(type)}`,
      });
      return;
    }
    const msg = parsed.data;
    switch (msg.t) {
      case 'JOIN_LOBBY':
        this.onJoinLobby(client, msg);
        return;
      case 'CREATE_ROOM':
        void this.onCreateRoom(client, msg);
        return;
      case 'JOIN_ROOM':
        this.onJoinRoom(client, msg);
        return;
      case 'QUICK_MATCH':
      case 'CANCEL_QUICK_MATCH':
        // Queue-based quick match is M3c.
        client.send('ERROR', {
          code: 'NOT_IMPLEMENTED',
          message: 'QUICK_MATCH is not available yet',
        });
        return;
      case 'LEAVE_LOBBY':
        client.leave(1000, 'consented');
        return;
    }
  }

  private onJoinLobby(client: Client, msg: Extract<LobbyC2S, { t: 'JOIN_LOBBY' }>): void {
    const nickname = sanitizeNickname(msg.nickname);
    this.clientNicknames.set(client.sessionId, { nickname });
    client.send('LOBBY_JOINED', { playerId: client.sessionId });
    // Send the current room list as a one-shot snapshot. After this,
    // the schema patch stream keeps the client updated automatically.
    client.send('LOBBY_STATE', { rooms: Array.from(this.state.rooms.values()).map(toSummary) });
  }

  private async onCreateRoom(
    client: Client,
    msg: Extract<LobbyC2S, { t: 'CREATE_ROOM' }>,
  ): Promise<void> {
    if (this.state.rooms.size >= config.maxRooms) {
      client.send('ERROR', { code: 'TOO_MANY_ROOMS', message: 'server is at room capacity' });
      return;
    }
    const roomId = randomId('r_');
    const joinCode = msg.isPrivate ? randomJoinCode() : undefined;
    try {
      await matchMaker.createRoom('match', {
        roomId,
        capacity: msg.capacity,
        colorMode: msg.colorMode,
        isPrivate: msg.isPrivate,
        joinCode,
        name: msg.name ?? '',
      });
      client.send('ROOM_CREATED', { roomId, joinCode });
      logger.info({ roomId, by: client.sessionId }, 'room created');
    } catch (err) {
      logger.error({ err }, 'createRoom failed');
      client.send('ERROR', { code: 'CREATE_FAILED', message: 'could not create room' });
    }
  }

  private onJoinRoom(client: Client, msg: Extract<LobbyC2S, { t: 'JOIN_ROOM' }>): void {
    const row = this.state.rooms.get(msg.roomId);
    if (!row) {
      client.send('JOIN_ROOM_REJECTED', { reason: 'NOT_FOUND' });
      return;
    }
    if (row.status !== 'lobby') {
      client.send('JOIN_ROOM_REJECTED', { reason: 'MATCH_IN_PROGRESS' });
      return;
    }
    if (row.players >= row.capacity) {
      client.send('JOIN_ROOM_REJECTED', { reason: 'FULL' });
      return;
    }
    // matchRoomUrl is just the room id — the client uses Colyseus
    // `joinById(roomId)` rather than constructing a URL itself.
    client.send('JOIN_ROOM_OK', { roomId: msg.roomId, matchRoomUrl: msg.roomId });
  }
}

function toSummary(row: RoomSummarySchema) {
  return {
    roomId: row.roomId,
    name: row.name,
    capacity: row.capacity as 2 | 3 | 4,
    colorMode: row.colorMode as 4 | 5,
    players: row.players,
    isPrivate: row.isPrivate,
    status: row.status,
  };
}
