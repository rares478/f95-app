export type OverlayTab = 'notes' | 'guides' | 'browser';

export const OVERLAY_TAB_ORDER: OverlayTab[] = ['notes', 'guides', 'browser'];

export const OVERLAY_WIP_TABS: ReadonlySet<OverlayTab> = new Set(['guides']);
