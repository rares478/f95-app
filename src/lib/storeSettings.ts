import * as settings from './settings';

export type StoreScrollMode = 'infinite' | 'pagination';

export interface StoreSettings {
  scrollMode: StoreScrollMode;
}

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  scrollMode: 'infinite',
};

export async function loadStoreSettings(): Promise<StoreSettings> {
  const raw = await settings.get(settings.KEY_STORE_SCROLL_MODE);
  return {
    scrollMode: raw === 'pagination' ? 'pagination' : DEFAULT_STORE_SETTINGS.scrollMode,
  };
}

export async function saveStoreSettings(patch: Partial<StoreSettings>): Promise<StoreSettings> {
  const current = await loadStoreSettings();
  const next = { ...current, ...patch };
  await settings.set(settings.KEY_STORE_SCROLL_MODE, next.scrollMode);
  return next;
}
