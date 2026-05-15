/**
 * Colyseus state placeholders.
 *
 * @colyseus/schema 3.x ships TC39-style decorator metadata that, on
 * the runtime stack we're targeting (Node 24 + tsx + tsconfig
 * experimentalDecorators), does not survive into the encoder — fields
 * declared with `@type(...)` blow up `encodeValue` with a
 * `Symbol.metadata`-undefined crash the first time the room tries to
 * patch state. Until we move to a runtime that fully implements the
 * stage-3 decorator metadata proposal, M3a sidesteps schema sync
 * entirely and pushes all room state to clients via manual
 * `broadcast(...)` of the zod-typed protocol messages we already
 * defined in `@chaindrop/shared/protocol`.
 *
 * The Room base class still expects a Schema for its initial join
 * handshake, so we keep empty subclasses here — no fields, no
 * decorators, no risk of the encoder ever touching the metadata path.
 */

import { Schema } from '@colyseus/schema';

export class LobbyState extends Schema {}
export class MatchRoomState extends Schema {}
