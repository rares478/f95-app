export interface RenpyProbeResult {
  isRenpyLayout: boolean;
  savesDir: string | null;
}

export type RenpySaveSlotKind = 'slot' | 'auto' | 'quick' | 'persistent' | 'other';

export interface RenpySaveSlot {
  key: string;
  kind: RenpySaveSlotKind | string;
  mtimeMs: number;
  sizeBytes: number;
  hasScreenshot: boolean;
}

export interface RenpyVarNode {
  path: string;
  name: string;
  type: string;
  value?: unknown;
  editable: boolean;
  children?: RenpyVarNode[];
}

export interface RenpySavePatch {
  path: string;
  value: unknown;
}

export interface RenpySaveBackup {
  fileName: string;
  path: string;
  mtimeMs: number;
  sizeBytes: number;
}
