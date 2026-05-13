/**
 * MatchRoom — one Colyseus room per match instance.
 *
 * M3a scope: join / leave, READY toggle, countdown, MATCH_START with
 * seed + drop queue, transition to `running`. INPUT forwarding,
 * STATE_HASH desync detection, and reconnect support are M3b/M3c.
 *
 * See D6 §6.
 */

import { generateDropQueue } from '@chaindrop/shared';
import { type RoomSummary, matchC2S } from '@chaindrop/shared/protocol';
import { type Client, Room } from '@colyseus/core';
import { lobbyBus } from '../util/lobbyBus';
import { logger } from '../util/logger';
import { sanitizeNickname } from '../util/sanitize';
import { MatchPlayerSchema, MatchRoomState } from './state';

export interface MatchCreateOptions {
  roomId: string;
  capacity: 2 | 3 | 4;
  colorMode: 4 | 5;
  isPrivate: boolean;
  joinCode?: string;
  name: string;
}

export interface MatchJoinOptions {
  joinCode?: string;
  nickname: string;
  characterId: string;
}

const COUNTDOWN_FRAMES = 180;
const COUNTDOWN_MS = 3_000; // 3 seconds, matches D2 §1.4 / D4 §3.2
const DROP_QUEUE_LENGTH = 1024;
// Slight latency buffer so every client has the MATCH_START message in
// hand before they're asked to start ticking. Tuned to comfortably
// cover an inter-region websocket round-trip.
const MATCH_BEGIN_PADDING_MS = 200;

export class MatchRoom extends Room<MatchRoomState> {
  override maxClients = 4;
  override autoDispose = false;

  private roomIdValue = '';
  private joinCode: string | undefined;
  private name = '';
  private countdownHandle: ReturnType<Room['clock']['setTimeout']> | undefined;
  private matchSeed = 0;
  private dropQueue: [string, string][] = [];

  override onCreate(opts: MatchCreateOptions): void {
    this.setState(new MatchRoomState());
    this.state.config.capacity = opts.capacity;
    this.state.config.colorMode = opts.colorMode;
    this.state.config.isPrivate = opts.isPrivate;
    this.state.config.name = opts.name;
    this.maxClients = opts.capacity;
    this.roomIdValue = opts.roomId;
    this.joinCode = opts.joinCode;
    this.name = opts.name || `Match ${opts.roomId}`;
    // The roomId Colyseus assigns is random; we override it so the
    // lobby's roomId === the client-visible identifier.
    this.roomId = opts.roomId;

    this.onMessage('*', (client, type, message) => this.handle(client, type, message));

    lobbyBus.emit('room:created', this.summary());
    logger.info({ roomId: this.roomIdValue, capacity: opts.capacity }, 'MatchRoom created');
  }

  override onJoin(client: Client, opts: MatchJoinOptions): void {
    if (this.state.status !== 'lobby') {
      client.leave(4001, 'MATCH_IN_PROGRESS');
      return;
    }
    if (this.joinCode && opts.joinCode !== this.joinCode) {
      client.leave(4002, 'BAD_CODE');
      return;
    }

    const slot = this.assignSlot();
    const nickname = sanitizeNickname(opts.nickname);
    const player = new MatchPlayerSchema();
    player.playerId = client.sessionId;
    player.nickname = nickname;
    player.characterId = opts.characterId;
    player.slotIndex = slot;
    player.ready = false;
    player.connected = true;
    this.state.players.set(client.sessionId, player);

    lobbyBus.emit('room:update', this.summary());
    logger.info({ roomId: this.roomIdValue, sessionId: client.sessionId, slot }, 'match join');
  }

  override onLeave(client: Client, _consented: boolean): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    // M3b will wrap `running` leaves with `allowReconnection` and a
    // disconnect timer — for now we just remove the player.
    this.state.players.delete(client.sessionId);

    if (this.state.status === 'countdown') {
      // Someone bailed mid-countdown — abort and rewind to lobby.
      this.cancelCountdown('PLAYER_LEFT');
    }

    if (this.state.players.size === 0) {
      this.state.status = 'lobby';
      lobbyBus.emit('room:removed', this.roomIdValue);
      this.disconnect();
      return;
    }
    lobbyBus.emit('room:update', this.summary());
  }

  override onDispose(): void {
    lobbyBus.emit('room:removed', this.roomIdValue);
    logger.info({ roomId: this.roomIdValue }, 'MatchRoom disposed');
  }

  // ----------------------------------------------------------------

  private handle(client: Client, type: string | number, raw: unknown): void {
    const parsed = matchC2S.safeParse({
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
      case 'MATCH_JOIN':
        // The actual join happens in `onJoin`; this is a redundant ack
        // path that allows clients to update their nickname/character
        // mid-lobby. We accept but do nothing yet.
        return;
      case 'SET_READY':
        this.onSetReady(client, msg.ready);
        return;
      case 'MATCH_ACK':
        return; // M3b uses ACK to gate MATCH_BEGIN; harmless here.
      case 'INPUT':
      case 'STATE_HASH':
        // INPUT relay and STATE_HASH desync detection are M3b.
        return;
      case 'PING':
        client.send('PONG', { clientMs: msg.clientMs, serverMs: Date.now() });
        return;
      case 'LEAVE_MATCH':
        client.leave(1000, 'consented');
        return;
    }
  }

  private onSetReady(client: Client, ready: boolean): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    p.ready = ready;
    // Cancel the countdown if anyone un-readies while it is running.
    if (this.state.status === 'countdown' && !ready) {
      this.cancelCountdown('PLAYER_UNREADIED');
      return;
    }
    this.checkAllReady();
  }

  private checkAllReady(): void {
    if (this.state.status !== 'lobby') return;
    const players = Array.from(this.state.players.values());
    const full = players.length === this.state.config.capacity;
    const allReady = players.every((p) => p.ready && p.connected);
    if (full && allReady) {
      this.startCountdown();
    }
  }

  private startCountdown(): void {
    this.state.status = 'countdown';
    lobbyBus.emit('room:update', this.summary());
    this.broadcast('COUNTDOWN_START', {
      durationFrames: COUNTDOWN_FRAMES,
      serverStartMs: Date.now(),
    });
    this.countdownHandle = this.clock.setTimeout(() => this.beginMatch(), COUNTDOWN_MS);
    logger.info({ roomId: this.roomIdValue }, 'countdown started');
  }

  private cancelCountdown(reason: string): void {
    this.countdownHandle?.clear();
    this.countdownHandle = undefined;
    this.state.status = 'lobby';
    this.broadcast('COUNTDOWN_CANCEL', { reason });
    lobbyBus.emit('room:update', this.summary());
    logger.info({ roomId: this.roomIdValue, reason }, 'countdown cancelled');
  }

  private beginMatch(): void {
    // Seed is a non-zero 32-bit integer so the xorshift32 RNG in shared
    // never gets stuck on zero. Drop queue is generated once on the
    // server and pushed to every client so all sims are deterministic.
    this.matchSeed = (Math.floor(Math.random() * 0xfffffffe) + 1) | 0;
    this.dropQueue = generateDropQueue(
      this.matchSeed,
      DROP_QUEUE_LENGTH,
      this.state.config.colorMode as 4 | 5,
    ) as unknown as [string, string][];

    const playerOrder = Array.from(this.state.players.values())
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((p) => p.playerId);

    this.state.status = 'running';
    lobbyBus.emit('room:update', this.summary());

    this.broadcast('MATCH_START', {
      seed: this.matchSeed,
      dropQueue: this.dropQueue,
      playerOrder,
      startFrameMs: Date.now() + MATCH_BEGIN_PADDING_MS,
    });

    // MATCH_BEGIN is the simulator-tick trigger; we send it once the
    // pad has elapsed so every client has had time to receive
    // MATCH_START and prime its scheduler.
    this.clock.setTimeout(() => {
      this.broadcast('MATCH_BEGIN', {});
    }, MATCH_BEGIN_PADDING_MS);

    logger.info({ roomId: this.roomIdValue, seed: this.matchSeed }, 'match started');
  }

  private assignSlot(): number {
    const used = new Set<number>();
    for (const p of this.state.players.values()) used.add(p.slotIndex);
    for (let i = 0; i < this.state.config.capacity; i++) {
      if (!used.has(i)) return i;
    }
    return this.state.players.size; // fallback, shouldn't normally hit
  }

  private summary(): RoomSummary {
    return {
      roomId: this.roomIdValue,
      name: this.name,
      capacity: this.state.config.capacity as 2 | 3 | 4,
      colorMode: this.state.config.colorMode as 4 | 5,
      players: this.state.players.size,
      isPrivate: this.state.config.isPrivate,
      status: this.state.status === 'finished' ? 'lobby' : this.state.status,
    };
  }
}
