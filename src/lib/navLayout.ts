/**
 * Navigation chrome layout — sidebar (default) or horizontal top bar.
 */
import * as settings from './settings';

export const KEY_NAV_LAYOUT = 'nav_layout';

export type NavLayoutId = 'side' | 'top';

export const NAV_LAYOUTS: { id: NavLayoutId; labelKey: string; hintKey: string }[] = [
  { id: 'side', labelKey: 'settings.navLayout.side', hintKey: 'settings.navLayout.sideHint' },
  { id: 'top', labelKey: 'settings.navLayout.top', hintKey: 'settings.navLayout.topHint' },
];

export const NAV_LAYOUT_CHANGE_EVENT = 'f95:nav-layout-changed';

const DEFAULT_LAYOUT: NavLayoutId = 'side';

function notify() {
  window.dispatchEvent(new CustomEvent(NAV_LAYOUT_CHANGE_EVENT));
}

export function applyNavLayout(id: NavLayoutId): void {
  if (!NAV_LAYOUTS.some((l) => l.id === id)) return;
  document.documentElement.setAttribute('data-nav-layout', id);
}

export async function loadSavedNavLayout(): Promise<NavLayoutId> {
  try {
    const raw = await settings.get(KEY_NAV_LAYOUT);
    if (raw === 'side' || raw === 'top') return raw;
  } catch (err) {
    console.warn('[navLayout] failed to load saved layout', err);
  }
  return DEFAULT_LAYOUT;
}

export async function setNavLayout(id: NavLayoutId): Promise<void> {
  applyNavLayout(id);
  try {
    await settings.set(KEY_NAV_LAYOUT, id);
  } catch (err) {
    console.warn('[navLayout] failed to persist', err);
  }
  notify();
}

export function currentNavLayout(): NavLayoutId {
  const attr = document.documentElement.getAttribute('data-nav-layout');
  if (attr === 'side' || attr === 'top') return attr;
  return DEFAULT_LAYOUT;
}
