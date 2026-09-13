import { describe, expect, it } from 'vitest';
import { matchInstalledVersion } from './matchInstalledVersion';

const entries = [
  { title: 'v0.6.1', bodyHtml: '' },
  { title: 'v0.6', bodyHtml: '' },
  { title: 'Season 1 - v1.1.55 - Redux', bodyHtml: '' },
  { title: 'v2.0 Remake', bodyHtml: '' },
];

describe('matchInstalledVersion', () => {
  it('matches plain and v-prefixed installed versions', () => {
    expect(matchInstalledVersion(entries, '0.6.1')).toBe(0);
    expect(matchInstalledVersion(entries, 'v0.6')).toBe(1);
  });

  it('matches version core inside long titles', () => {
    expect(matchInstalledVersion(entries, '1.1.55')).toBe(2);
  });

  it('matches remake-style titles', () => {
    expect(matchInstalledVersion(entries, '2.0')).toBe(3);
  });

  it('returns -1 when no match', () => {
    expect(matchInstalledVersion(entries, '9.9.9')).toBe(-1);
    expect(matchInstalledVersion(entries, null)).toBe(-1);
  });

  it('does not treat a shorter core as a prefix match', () => {
    // Only v0.6.1 present — installed 0.6 must not highlight it
    expect(matchInstalledVersion([{ title: 'v0.6.1', bodyHtml: '' }], '0.6')).toBe(
      -1,
    );
  });
});
