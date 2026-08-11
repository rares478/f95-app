import { describe, expect, it } from 'vitest';
import { mapAuthFailCode } from './appLog';

describe('mapAuthFailCode', () => {
  it('maps backend codes without leaking messages', () => {
    expect(mapAuthFailCode({ code: 'invalid_credentials', message: 'nope' })).toBe(
      'invalid_credentials',
    );
    expect(mapAuthFailCode({ code: 'two_factor_required', message: 'x' })).toBe('two_factor');
    expect(mapAuthFailCode({ code: 'cloudflare', message: 'cf' })).toBe('cloudflare');
    expect(mapAuthFailCode({ code: 'sidecar_timeout', message: 't' })).toBe('sidecar');
    expect(mapAuthFailCode({ code: 'other', message: 'weird' })).toBe('other');
    expect(mapAuthFailCode('stringy')).toBe('other');
  });
});
