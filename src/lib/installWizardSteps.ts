export type InstallWizardStep = 'platform' | 'season' | 'package' | 'hosts';

/**
 * When preferSeasonStep is set and the season step exists (multi-season
 * platform), start there so Back can still return to platform.
 */
export function resolveInitialWizardStep(
  steps: InstallWizardStep[],
  preferSeasonStep: boolean,
): InstallWizardStep {
  if (preferSeasonStep && steps.includes('season')) return 'season';
  return steps[0] ?? 'hosts';
}
