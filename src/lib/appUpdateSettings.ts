import * as settings from './settings';

export const KEY_APP_AUTO_UPDATE = 'app.autoUpdate';

export async function getAutoUpdateEnabled(): Promise<boolean> {
  return settings.getBool(KEY_APP_AUTO_UPDATE, true);
}

export async function setAutoUpdateEnabled(enabled: boolean): Promise<void> {
  await settings.setBool(KEY_APP_AUTO_UPDATE, enabled);
}
