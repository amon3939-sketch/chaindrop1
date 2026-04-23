import { describe, expect, it } from 'vitest';
import { config } from './config';

describe('config', () => {
  it('provides a numeric port', () => {
    expect(typeof config.port).toBe('number');
    expect(config.port).toBeGreaterThan(0);
  });

  it('parses allowedOrigins as an array', () => {
    expect(Array.isArray(config.allowedOrigins)).toBe(true);
    expect(config.allowedOrigins.length).toBeGreaterThan(0);
  });

  it('has a max rooms limit', () => {
    expect(config.maxRooms).toBeGreaterThan(0);
  });
});
