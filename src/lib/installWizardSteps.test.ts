import { describe, expect, it } from 'vitest';
import { resolveInitialWizardStep } from './installWizardSteps';

describe('resolveInitialWizardStep', () => {
  it('returns first step when preferSeasonStep is false', () => {
    expect(
      resolveInitialWizardStep(['platform', 'season', 'hosts'], false),
    ).toBe('platform');
  });

  it('jumps to season when preferred and season is available', () => {
    expect(
      resolveInitialWizardStep(['platform', 'season', 'hosts'], true),
    ).toBe('season');
  });

  it('does not invent season when it is not in steps', () => {
    expect(resolveInitialWizardStep(['platform', 'hosts'], true)).toBe(
      'platform',
    );
  });

  it('defaults to hosts when steps empty', () => {
    expect(resolveInitialWizardStep([], true)).toBe('hosts');
  });
});
