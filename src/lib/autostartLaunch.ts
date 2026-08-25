import type { AppRuntimeSettings } from './appRuntimeSettings';

export const AUTOSTART_ARG = '--autostart';

export function shouldHideOnAutostartLaunch(
  args: string[],
  s: Pick<AppRuntimeSettings, 'startHiddenOnAutostart' | 'trayIconEnabled'>,
): boolean {
  return args.includes(AUTOSTART_ARG) && s.startHiddenOnAutostart && s.trayIconEnabled;
}
