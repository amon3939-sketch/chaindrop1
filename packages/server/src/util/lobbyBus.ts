/**
 * Process-local pub/sub channel that lets MatchRoom instances tell the
 * LobbyRoom when they are created, when their state changes, and when
 * they shut down. See D6 §5.4.
 *
 * Both rooms run in the same Node process, so a plain EventEmitter is
 * enough — we never need to round-trip through the websocket layer.
 */

import { EventEmitter } from 'node:events';
import type { RoomSummary } from '@chaindrop/shared/protocol';

export interface LobbyBusEvents {
  'room:created': (summary: RoomSummary) => void;
  'room:update': (summary: RoomSummary) => void;
  'room:removed': (roomId: string) => void;
}

class TypedEmitter extends EventEmitter {
  override emit<E extends keyof LobbyBusEvents>(
    event: E,
    ...args: Parameters<LobbyBusEvents[E]>
  ): boolean {
    return super.emit(event, ...args);
  }
  override on<E extends keyof LobbyBusEvents>(event: E, listener: LobbyBusEvents[E]): this {
    return super.on(event, listener);
  }
  override off<E extends keyof LobbyBusEvents>(event: E, listener: LobbyBusEvents[E]): this {
    return super.off(event, listener);
  }
}

export const lobbyBus = new TypedEmitter();
