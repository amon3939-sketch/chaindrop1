import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.logLevel,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
