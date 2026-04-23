import { PROTOCOL_VERSION } from '@chaindrop/shared';
import { describe, expect, it } from 'vitest';

describe('client can import from shared', () => {
  it('exposes PROTOCOL_VERSION', () => {
    expect(typeof PROTOCOL_VERSION).toBe('number');
  });
});
