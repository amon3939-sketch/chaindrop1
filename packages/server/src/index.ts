/**
 * ChainDrop server entry point. See D6 §4.
 *
 * Boots a single Colyseus game server that hosts the always-on
 * `lobby` room plus on-demand `match` rooms created via the
 * matchmaker. The HTTP side serves `/healthz` and, when enabled, the
 * Colyseus monitor under `/monitor`.
 */
import { createServer } from 'node:http';
import { PROTOCOL_VERSION } from '@chaindrop/shared';
import { Server } from '@colyseus/core';
import { monitor } from '@colyseus/monitor';
import { WebSocketTransport } from '@colyseus/ws-transport';
import cors from 'cors';
import express from 'express';
import basicAuth from 'express-basic-auth';
import { config } from './config';
import { LobbyRoom } from './rooms/LobbyRoom';
import { MatchRoom } from './rooms/MatchRoom';
import { logger } from './util/logger';

const app = express();

app.use(
  cors({
    origin: config.allowedOrigins.includes('*') ? true : config.allowedOrigins,
  }),
);
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    protocolVersion: PROTOCOL_VERSION,
  });
});

if (config.monitor.enabled) {
  app.use(
    '/monitor',
    basicAuth({
      users: { [config.monitor.user]: config.monitor.pass },
      challenge: true,
    }),
    monitor(),
  );
}

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('lobby', LobbyRoom);
// `filterBy(['roomId'])` lets the client `joinById(roomId)` and have
// Colyseus route to the MatchRoom whose `onCreate` set this exact id.
gameServer.define('match', MatchRoom).filterBy(['roomId']);

gameServer.listen(config.port);
logger.info({ port: config.port, protocolVersion: PROTOCOL_VERSION }, 'server listening');
