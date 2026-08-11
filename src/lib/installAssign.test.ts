import { describe, expect, it } from 'vitest';
import { defaultExeLabel, shouldAutoAssign } from './installAssign';
import type { SectionKind } from './installSections';

describe('shouldAutoAssign', () => {
  const base = {
    jobCount: 1,
    sectionKind: 'current_os' as SectionKind,
    exePath: 'D:/games/play.exe',
  };

  it('is true for single current_os job with exe', () => {
    expect(shouldAutoAssign(base)).toBe(true);
  });

  it('is false when jobCount is not 1', () => {
    expect(shouldAutoAssign({ ...base, jobCount: 0 })).toBe(false);
    expect(shouldAutoAssign({ ...base, jobCount: 2 })).toBe(false);
  });

  it('is false when sectionKind is not current_os', () => {
    const kinds: SectionKind[] = ['legacy', 'patch', 'extra', 'other'];
    for (const sectionKind of kinds) {
      expect(shouldAutoAssign({ ...base, sectionKind })).toBe(false);
    }
  });

  it('is false when exePath is missing', () => {
    expect(shouldAutoAssign({ ...base, exePath: null })).toBe(false);
    expect(shouldAutoAssign({ ...base, exePath: '' })).toBe(false);
  });
});

describe('defaultExeLabel', () => {
  it('returns trimmed section label when non-empty', () => {
    expect(defaultExeLabel('  Win/Linux  ', 'D:/games/play.exe')).toBe('Win/Linux');
  });

  it('falls back to filename when section label is empty', () => {
    expect(defaultExeLabel('  ', 'D:/games/S2/play.exe')).toBe('play.exe');
    expect(defaultExeLabel('', 'D:\\games\\S2\\play.exe')).toBe('play.exe');
  });

  it('returns empty string when label empty and exePath null', () => {
    expect(defaultExeLabel('   ', null)).toBe('');
  });
});
