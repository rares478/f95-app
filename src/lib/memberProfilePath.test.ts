import { describe, expect, it } from 'vitest';
import { memberProfilePath } from './memberProfilePath';

describe('memberProfilePath', () => {
  it('returns members path for numeric ids', () => {
    expect(memberProfilePath('55')).toBe('/members/55');
  });
  it('returns null for empty', () => {
    expect(memberProfilePath(null)).toBeNull();
    expect(memberProfilePath('')).toBeNull();
    expect(memberProfilePath('  ')).toBeNull();
  });
});
