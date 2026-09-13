import { describe, expect, it } from 'vitest';
import { isChangelogHeader } from './isChangelogHeader';

describe('isChangelogHeader', () => {
  it('accepts common version titles', () => {
    for (const t of [
      'v0.6.1',
      'V 0.1',
      'v.1.07.3c',
      'v0.08.0.3',
      'v0.09.0:',
      'v0.2.2 - Chapter 02',
      'v2.0 Remake',
    ]) {
      expect(isChangelogHeader(t).ok, t).toBe(true);
    }
  });

  it('accepts chapter and season forms', () => {
    expect(isChangelogHeader('Chapter 4 v1.0 Build 2').ok).toBe(true);
    expect(isChangelogHeader('Season 1 - v1.1.55 - Redux').ok).toBe(true);
    expect(isChangelogHeader('2026-05-28').ok).toBe(true);
  });

  it('accepts soft season only when bold', () => {
    expect(isChangelogHeader('Season 1 Redux', { fromBold: true }).ok).toBe(true);
    expect(isChangelogHeader('Season 1 Redux', { fromBold: false }).ok).toBe(false);
  });

  it('rejects long prose', () => {
    expect(
      isChangelogHeader(
        'Fixed an issue causing saves to revert to the Lucania intro. You can now complete the event.',
      ).ok,
    ).toBe(false);
  });
});
