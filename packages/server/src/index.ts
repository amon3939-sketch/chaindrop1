/**
 * ChainDrop server entry point.
 * M0 scaffold: health check + placeholder Colyseus boot.
 * Full implementation per D6 §4 begins in M4.
 */
import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import { PROTOCOL_VERSION } from '@chaindrop/shared';
import { config } from './config';
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

const httpServer = createServer(app);

httpServer.listen(config.port, () => {
  logger.info({ port: config.port, protocolVersion: PROTOCOL_VERSION }, 'server listening');
});
