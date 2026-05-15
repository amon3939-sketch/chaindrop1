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
 *
 * NOTE: Auto-synced Colyseus schema state is not used here. See the
 * comment at the top of `state.ts` for the rationale; the lobby tracks
 * its room list in a plain `Map` and broadcasts `LOBBY_STATE` whenever
 * the list changes.
 */

import { type LobbyC2S, lobbyC2S } from '@chaindrop/shared/protocol';
import { type Client, Room, matchMaker } from '@colyseus/core';
import { config } from '../config';
import { randomId, randomJoinCode } from '../util/ids';
import { lobbyBus, matchRooms } from '../util/lobbyBus';
import { logger } from '../util/logger';
import { sanitizeNickname } from '../util/sanitize';
import { LobbyState } from './state';

interface JoinedClient {
  nickname: string;
}

export class LobbyRoom extends Room<LobbyState> {
  override maxClients = 200;
  private clientNicknames = new Map<string, JoinedClient>();
  // Bound listeners we register on lobbyBus — kept on the instance so
  // onDispose can detach them and avoid a memory leak as Colyseus
  // recycles LobbyRoom instances.
  private onRoomCreated = (summary: { roomId: string }) => {
    void summary;
    this.broadcastList();
  };
  private onRoomUpdate = (summary: { roomId: string }) => {
    void summary;
    this.broadcastList();
  };
  private onRoomRemoved = (_roomId: string) => {
    this.broadcastList();
  };

  override onCreate(): void {
    this.setState(new LobbyState());
    this.onMessage('*', (client, type, message) => this.handle(client, type, message));

    // MatchRoom owns the registry writes (in `util/lobbyBus.ts`); we
    // just forward every change as a LOBBY_STATE broadcast.
    lobbyBus.on('room:created', this.onRoomCreated);
    lobbyBus.on('room:update', this.onRoomUpdate);
    lobbyBus.on('room:removed', this.onRoomRemoved);

    logger.info('LobbyRoom created');
  }

  override onJoin(client: Client): void {
    this.clientNicknames.set(client.sessionId, { nickname: '' });
    logger.info({ sessionId: client.sessionId }, 'lobby join');
  }

  override onLeave(client: Client): void {
    this.clientNicknames.delete(client.sessionId);
    logger.info({ sessionId: client.sessionId }, 'lobby leave');
  }

  override onDispose(): void {
    lobbyBus.off('room:created', this.onRoomCreated);
    lobbyBus.off('room:update', this.onRoomUpdate);
    lobbyBus.off('room:removed', this.onRoomRemoved);
  }

  // ----------------------------------------------------------------

  private broadcastList(): void {
    this.broadcast('LOBBY_STATE', { rooms: Array.from(matchRooms.values()) });
  }

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
    // Send the current room list as the initial snapshot. Subsequent
    // updates arrive via the lobbyBus → broadcastList path.
    client.send('LOBBY_STATE', { rooms: Array.from(matchRooms.values()) });
  }

  private async onCreateRoom(
    client: Client,
    msg: Extract<LobbyC2S, { t: 'CREATE_ROOM' }>,
  ): Promise<void> {
    if (matchRooms.size >= config.maxRooms) {
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
    const row = matchRooms.get(msg.roomId);
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
