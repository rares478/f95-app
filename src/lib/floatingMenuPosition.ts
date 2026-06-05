import type { CSSProperties } from 'react';

const GAP = 4;
const MENU_MAX_HEIGHT = 220;
/** Title bar + status bar + breathing room inside the Tauri window. */
const VIEWPORT_TOP_PAD = 8;
const VIEWPORT_BOTTOM_CHROME = 52;

export type FloatingMenuAnchor = {
  getBoundingClientRect: () => DOMRect;
};

export function computeFloatingMenuStyle(
  anchor: FloatingMenuAnchor,
  menuHeight = MENU_MAX_HEIGHT,
): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const vh = window.innerHeight;
  const usableBottom = vh - VIEWPORT_BOTTOM_CHROME;
  const spaceBelow = usableBottom - rect.bottom - GAP;
  const spaceAbove = rect.top - GAP - VIEWPORT_TOP_PAD;
  const needed = Math.min(MENU_MAX_HEIGHT, Math.max(menuHeight, 80));

  const openUp =
    spaceBelow < needed || spaceBelow < spaceAbove || rect.bottom > usableBottom - 80;

  if (openUp) {
    return {
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      bottom: vh - rect.top + GAP,
      maxHeight: Math.min(MENU_MAX_HEIGHT, Math.max(96, spaceAbove)),
    };
  }

  return {
    position: 'fixed',
    left: rect.left,
    width: rect.width,
    top: rect.bottom + GAP,
    maxHeight: Math.min(MENU_MAX_HEIGHT, Math.max(96, spaceBelow)),
  };
}

export function clampFloatingMenuStyle(
  style: CSSProperties,
  menuEl: HTMLElement,
  anchor: FloatingMenuAnchor,
): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const menuRect = menuEl.getBoundingClientRect();
  const vh = window.innerHeight;
  const usableBottom = vh - VIEWPORT_BOTTOM_CHROME;

  if (menuRect.bottom > usableBottom || menuRect.top < VIEWPORT_TOP_PAD) {
    const spaceAbove = rect.top - GAP - VIEWPORT_TOP_PAD;
    return {
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      bottom: vh - rect.top + GAP,
      maxHeight: Math.min(MENU_MAX_HEIGHT, Math.max(96, spaceAbove)),
    };
  }

  return style;
}

export function floatingMenuStyleKey(style: CSSProperties): string {
  return [style.top, style.bottom, style.left, style.width, style.maxHeight].join('|');
}
