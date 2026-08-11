import { useSyncExternalStore } from 'react';
import { currentNavLayout, NAV_LAYOUT_CHANGE_EVENT, type NavLayoutId } from '../lib/navLayout';

function subscribe(onChange: () => void): () => void {
  window.addEventListener(NAV_LAYOUT_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(NAV_LAYOUT_CHANGE_EVENT, onChange);
}

/** Reactive nav layout for AppShell and other layout-sensitive components. */
export function useNavLayout(): NavLayoutId {
  return useSyncExternalStore(subscribe, currentNavLayout);
}
