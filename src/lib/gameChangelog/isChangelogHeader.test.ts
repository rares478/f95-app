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
      '0.06.6',
      '0.06.5',
    ]) {
      expect(isChangelogHeader(t).ok, t).toBe(true);
    }
  });

  it('accepts chapter and season forms', () => {
    expect(isChangelogHeader('Chapter 4 v1.0 Build 2').ok).toBe(true);
    expect(isChangelogHeader('Season 1 - v1.1.55 - Redux').ok).toBe(true);
    expect(isChangelogHeader('2026-05-28').ok).toBe(true);
    expect(isChangelogHeader('26/06/2024', { fromBold: true }).ok).toBe(true);
    expect(isChangelogHeader('26/06/2024').ok).toBe(false);
    expect(isChangelogHeader('3/4/2024', { fromBold: true }).ok).toBe(true);
  });

  it('accepts soft chapter labels only when bold', () => {
    expect(isChangelogHeader('Chapter 4', { fromBold: true }).ok).toBe(true);
    expect(isChangelogHeader('Chapter 4 Beta', { fromBold: true }).ok).toBe(true);
    expect(isChangelogHeader('Chapter 4').ok).toBe(false);
    expect(isChangelogHeader('Chapter 3 (V0.25)', { fromBold: true }).ok).toBe(
      true,
    );
  });

  it('accepts soft Part N labels only when bold', () => {
    expect(isChangelogHeader('Part 16', { fromBold: true }).ok).toBe(true);
    expect(isChangelogHeader('Part 8 BugFix', { fromBold: true }).ok).toBe(true);
    expect(isChangelogHeader('Part 16').ok).toBe(false);
  });

  it('accepts Chapter-Episode stamps with optional game acronym', () => {
    expect(isChangelogHeader('MBML (Chapter 2 - Episode 2)').ok).toBe(true);
    expect(
      isChangelogHeader('MBML (Chapter 1 - Episode 4) - Compliant Version:').ok,
    ).toBe(true);
    expect(isChangelogHeader('Chapter 2 - Episode 1').ok).toBe(true);
    expect(isChangelogHeader('Episode 7b', { fromBold: true }).ok).toBe(true);
    expect(isChangelogHeader('Episode 7b').ok).toBe(false);
    expect(isChangelogHeader('Ep1 - Part 2', { fromBold: true }).ok).toBe(true);
    expect(
      isChangelogHeader('Ep1 - Part 1b (Bug fix)', { fromBold: true }).ok,
    ).toBe(true);
    expect(isChangelogHeader("Emma's Solo Ending", { fromBold: true }).ok).toBe(
      true,
    );
    expect(isChangelogHeader("Emma's solo ending", { fromBold: true }).ok).toBe(
      false,
    );
  });

  it('accepts soft season only when bold', () => {
    expect(isChangelogHeader('Season 1 Redux', { fromBold: true }).ok).toBe(true);
    expect(isChangelogHeader('Season 1 Redux', { fromBold: false }).ok).toBe(false);
  });

  it('accepts soft release labels only when bold', () => {
    expect(isChangelogHeader('Final', { fromBold: true }).ok).toBe(true);
    expect(isChangelogHeader('Final', { fromBold: false }).ok).toBe(false);
    expect(isChangelogHeader('Latest', { fromBold: true }).ok).toBe(true);
  });

  it('accepts Changelog (wip.N) labels when bold', () => {
    expect(isChangelogHeader('Changelog (wip.7944):', { fromBold: true }).ok).toBe(
      true,
    );
    expect(isChangelogHeader('Changelog (wip.7944)', { fromBold: true }).ok).toBe(
      true,
    );
    expect(isChangelogHeader('Changelog (wip.7944)', { fromBold: false }).ok).toBe(
      false,
    );
  });

  it('accepts bare wip.N version cores', () => {
    expect(isChangelogHeader('wip.7944').ok).toBe(true);
    expect(isChangelogHeader('wip.7712 - hotfix').ok).toBe(true);
  });

  it('rejects unbolded version-like body sentences', () => {
    expect(isChangelogHeader('V0.2 translation transferred').ok).toBe(false);
    expect(
      isChangelogHeader('V0.2 translation transferred', { fromBold: true }).ok,
    ).toBe(true);
  });

  it('accepts bold Demo release labels with a version token', () => {
    expect(
      isChangelogHeader('Demo Translation V0.1', { fromBold: true }).ok,
    ).toBe(true);
    expect(
      isChangelogHeader('Demo 2.0, Translation V0.4', { fromBold: true }).ok,
    ).toBe(true);
    expect(isChangelogHeader('Demo Translation V0.1').ok).toBe(false);
  });

  it('accepts Vdd/mm/yy release stamps and Remastered vN titles', () => {
    expect(isChangelogHeader('V15/10/18 (0.6.1.0)').ok).toBe(true);
    expect(isChangelogHeader('v21/10/17:').ok).toBe(true);
    expect(
      isChangelogHeader('V04/12/18 (Wicked Choices: Book One v1.0)').ok,
    ).toBe(true);
    expect(isChangelogHeader('Remastered v1.0.1 - 2024-01-25').ok).toBe(true);
    expect(isChangelogHeader('Remaster v1.0.1').ok).toBe(true);
    expect(isChangelogHeader('REMASTERED v1.0').ok).toBe(true);
    expect(
      isChangelogHeader(
        'Remastered almost ALL scenes of the previous double update (v.0.95.7)',
      ).ok,
    ).toBe(false);
  });

  it('rejects long prose', () => {
    expect(
      isChangelogHeader(
        'Fixed an issue causing saves to revert to the Lucania intro. You can now complete the event.',
      ).ok,
    ).toBe(false);
  });
});
