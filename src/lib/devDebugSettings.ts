import * as settings from './settings';

export type DevDebugLayout = 'dock-bottom' | 'dock-right' | 'float';

export interface DevDebugFloatGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DevDebugSettings {
  panelEnabled: boolean;
  layout: DevDebugLayout;
  floatGeom: DevDebugFloatGeom;
  collapsed: boolean;
}

export const DEFAULT_FLOAT_GEOM: DevDebugFloatGeom = { x: 72, y: 72, w: 620, h: 380 };

const FLOAT_MIN_W = 300;
const FLOAT_MIN_H = 140;
const FLOAT_MARGIN = 16;
const FLOAT_EDGE = 0;

/** Clamp only x/y using the on-screen size (collapsed toolbar vs full panel). */
export function clampFloatPosition(
  geom: DevDebugFloatGeom,
  visible: { w: number; h: number },
  edge = FLOAT_EDGE,
): Pick<DevDebugFloatGeom, 'x' | 'y'> {
  if (typeof window === 'undefined') return { x: geom.x, y: geom.y };
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 720;
  const x = Math.min(Math.max(edge, geom.x), Math.max(edge, vw - visible.w - edge));
  const y = Math.min(Math.max(edge, geom.y), Math.max(edge, vh - visible.h - edge));
  return { x: Math.round(x), y: Math.round(y) };
}

/** Keep float window within the viewport — fixes corrupted sizes from older builds. */
export function clampFloatGeom(
  geom: DevDebugFloatGeom | null | undefined,
  visibleHeight?: number,
): DevDebugFloatGeom {
  const base = geom ?? DEFAULT_FLOAT_GEOM;
  const safe = {
    x: Number.isFinite(base.x) ? base.x : DEFAULT_FLOAT_GEOM.x,
    y: Number.isFinite(base.y) ? base.y : DEFAULT_FLOAT_GEOM.y,
    w: Number.isFinite(base.w) ? base.w : DEFAULT_FLOAT_GEOM.w,
    h: Number.isFinite(base.h) ? base.h : DEFAULT_FLOAT_GEOM.h,
  };
  if (typeof window === 'undefined') return safe;
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 720;
  const maxW = Math.max(FLOAT_MIN_W, vw - FLOAT_MARGIN * 2);
  const maxH = Math.max(FLOAT_MIN_H, vh - FLOAT_MARGIN * 2);
  const w = Math.min(Math.max(FLOAT_MIN_W, safe.w), maxW);
  const h = Math.min(Math.max(FLOAT_MIN_H, safe.h), maxH);
  const pos = clampFloatPosition({ ...safe, w, h }, { w, h: visibleHeight ?? h });
  return {
    x: pos.x,
    y: pos.y,
    w: Math.round(w),
    h: Math.round(h),
  };
}

export function isFloatGeomOversized(geom: DevDebugFloatGeom | null | undefined): boolean {
  if (!geom || !Number.isFinite(geom.w) || !Number.isFinite(geom.h)) return true;
  if (typeof window === 'undefined') return false;
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 720;
  return geom.w > vw * 0.85 || geom.h > vh * 0.85;
}

const DEFAULTS: DevDebugSettings = {
  panelEnabled: false,
  layout: 'dock-bottom',
  floatGeom: DEFAULT_FLOAT_GEOM,
  collapsed: false,
};

const listeners = new Set<(s: DevDebugSettings) => void>();
let cached: DevDebugSettings | null = null;

function parseFloatGeom(raw: string | null): DevDebugFloatGeom {
  if (!raw) return clampFloatGeom(DEFAULT_FLOAT_GEOM);
  try {
    const o = JSON.parse(raw) as Partial<DevDebugFloatGeom>;
    return clampFloatGeom({
      x: typeof o.x === 'number' ? o.x : DEFAULT_FLOAT_GEOM.x,
      y: typeof o.y === 'number' ? o.y : DEFAULT_FLOAT_GEOM.y,
      w: typeof o.w === 'number' ? o.w : DEFAULT_FLOAT_GEOM.w,
      h: typeof o.h === 'number' ? o.h : DEFAULT_FLOAT_GEOM.h,
    });
  } catch {
    return clampFloatGeom(DEFAULT_FLOAT_GEOM);
  }
}

function parseLayout(raw: string | null): DevDebugLayout {
  if (raw === 'dock-right' || raw === 'float') return raw;
  return 'dock-bottom';
}

function notify() {
  if (!cached) return;
  for (const fn of listeners) fn(cached);
}

export async function loadDevDebugSettings(): Promise<DevDebugSettings> {
  if (!import.meta.env.DEV) {
    cached = { ...DEFAULTS, panelEnabled: false };
    return cached;
  }
  const [panelEnabled, layoutRaw, geomRaw, collapsed] = await Promise.all([
    settings.getBool(settings.KEY_DEV_DEBUG_PANEL, false),
    settings.get(settings.KEY_DEV_DEBUG_LAYOUT),
    settings.get(settings.KEY_DEV_DEBUG_FLOAT_GEOM),
    settings.getBool(settings.KEY_DEV_DEBUG_COLLAPSED, false),
  ]);
  cached = {
    panelEnabled,
    layout: parseLayout(layoutRaw),
    floatGeom: parseFloatGeom(geomRaw),
    collapsed,
  };
  return cached;
}

export function getDevDebugSettings(): DevDebugSettings {
  return cached ?? DEFAULTS;
}

export function subscribeDevDebugSettings(fn: (s: DevDebugSettings) => void): () => void {
  listeners.add(fn);
  fn(getDevDebugSettings());
  return () => listeners.delete(fn);
}

export async function saveDevDebugSettings(
  patch: Partial<DevDebugSettings>,
): Promise<DevDebugSettings> {
  const current = cached ?? (await loadDevDebugSettings());
  const next: DevDebugSettings = {
    ...current,
    ...patch,
    floatGeom: patch.floatGeom
      ? clampFloatGeom({ ...current.floatGeom, ...patch.floatGeom })
      : current.floatGeom,
  };
  if (next.layout === 'float') {
    next.floatGeom = clampFloatGeom(next.floatGeom);
  }
  cached = next;
  await Promise.all([
    settings.setBool(settings.KEY_DEV_DEBUG_PANEL, next.panelEnabled),
    settings.set(settings.KEY_DEV_DEBUG_LAYOUT, next.layout),
    settings.set(settings.KEY_DEV_DEBUG_FLOAT_GEOM, JSON.stringify(next.floatGeom)),
    settings.setBool(settings.KEY_DEV_DEBUG_COLLAPSED, next.collapsed),
  ]);
  notify();
  return next;
}

export function isDevDebugPanelAvailable(): boolean {
  return import.meta.env.DEV;
}
