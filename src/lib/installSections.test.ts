import { describe, expect, it } from 'vitest';
import {
  buildInstallSections,
  classifySectionLabel,
  pickPreferredHost,
} from './installSections';
import type { GameDownload } from '../types/game';

const link = (over: Partial<GameDownload> & Pick<GameDownload, 'host' | 'url'>): GameDownload => ({
  text: over.host,
  group: null,
  ...over,
});

describe('classifySectionLabel', () => {
  it('marks Win/Linux as current_os on windows', () => {
    expect(classifySectionLabel('Win/Linux', 'windows')).toBe('current_os');
  });
  it('marks Mac as other on windows', () => {
    expect(classifySectionLabel('Mac', 'windows')).toBe('other');
  });
  it('marks Before the Tech Update as legacy', () => {
    expect(classifySectionLabel('Before the Tech Update (v0.20.16)', 'windows')).toBe('legacy');
  });
  it('marks Patches as patch', () => {
    expect(classifySectionLabel('Patches', 'windows')).toBe('patch');
  });
  it('marks Extras as extra', () => {
    expect(classifySectionLabel('Extras', 'windows')).toBe('extra');
  });
});

describe('buildInstallSections', () => {
  it('pre-checks only current_os', () => {
    const links: GameDownload[] = [
      link({ host: 'mega', url: 'https://mega.nz/a', group: 'Win/Linux' }),
      link({ host: 'mega', url: 'https://mega.nz/b', group: 'Mac' }),
      link({ host: 'mega', url: 'https://mega.nz/c', group: 'Patches' }),
      link({ host: 'mega', url: 'https://mega.nz/d', group: 'Extras' }),
    ];
    const sections = buildInstallSections(links, 'windows');
    expect(sections.map((s) => [s.label, s.defaultChecked])).toEqual([
      ['Win/Linux', true],
      ['Mac', false],
      ['Patches', false],
      ['Extras', false],
    ]);
  });
});

describe('pickPreferredHost', () => {
  it('prefers pixeldrain over mega when both present', () => {
    const picked = pickPreferredHost([
      link({ host: 'mega', url: 'https://mega.nz/a', group: 'Win/Linux' }),
      link({ host: 'pixeldrain', url: 'https://pixeldrain.com/a', group: 'Win/Linux' }),
    ]);
    expect(picked?.host).toBe('pixeldrain');
  });
});
