/**
 * Colyseus state schemas for LobbyRoom and MatchRoom.
 *
 * The fields here are the ones Colyseus auto-syncs to subscribed
 * clients. App-level zod messages (`@chaindrop/shared/protocol`) are
 * what the client *sends* and what the server emits via `broadcast` —
 * these schemas are the side-channel that Colyseus keeps in lockstep
 * automatically. We keep both shapes in sync by mapping schema fields
 * onto the protocol's `RoomSummary` / `MatchPlayer` types where
 * relevant.
 *
 * See D6 §5.2 and §6.2.
 */

import { MapSchema, Schema, type } from '@colyseus/schema';

export class RoomSummarySchema extends Schema {
  @type('string') roomId = '';
  @type('string') name = '';
  @type('number') capacity = 2;
  @type('number') colorMode = 4;
  @type('number') players = 0;
  @type('boolean') isPrivate = false;
  @type('string') status: 'lobby' | 'countdown' | 'running' | 'finished' = 'lobby';
}

export class LobbyState extends Schema {
  @type({ map: RoomSummarySchema }) rooms = new MapSchema<RoomSummarySchema>();
}

export class MatchPlayerSchema extends Schema {
  @type('string') playerId = '';
  @type('string') nickname = '';
  @type('string') characterId = '';
  @type('number') slotIndex = 0;
  @type('boolean') ready = false;
  @type('boolean') connected = true;
}

export class MatchConfigSchema extends Schema {
  @type('number') capacity = 2;
  @type('number') colorMode = 4;
  @type('boolean') isPrivate = false;
  @type('string') name = '';
}

export class MatchRoomState extends Schema {
  @type(MatchConfigSchema) config = new MatchConfigSchema();
  @type({ map: MatchPlayerSchema }) players = new MapSchema<MatchPlayerSchema>();
  @type('string') status: 'lobby' | 'countdown' | 'running' | 'finished' = 'lobby';
}
