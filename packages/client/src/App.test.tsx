import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@chaindrop/shared';

describe('client can import from shared', () => {
  it('exposes PROTOCOL_VERSION', () => {
    expect(typeof PROTOCOL_VERSION).toBe('number');
  });
});
