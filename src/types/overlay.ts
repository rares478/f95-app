export interface OverlayContext {
  threadId: string;
  title: string;
  thumbnailUrl: string | null;
  sessionId: number;
}

export interface OverlayCompactGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlayLayout {
  displayMode: 'fullscreen' | 'compact';
  geom?: OverlayCompactGeom;
}

export type OverlayAttachMode =
  | 'owned_window'
  | 'topmost_on_game'
  | 'monitor_fallback';

export interface OverlayAnchorStatus {
  attached: boolean;
  pid: number | null;
  gameRect: { x: number; y: number; width: number; height: number } | null;
  attachMode: OverlayAttachMode | null;
  message: string | null;
}
