import type { RenpyVarNode } from './renpySave';

export interface UnityProbeResult {
  isUnityLayout: boolean;
  localLowDir: string | null;
  company: string | null;
  product: string | null;
}

export interface UnitySaveSlot {
  key: string;
  displayName: string;
  kind: string;
  source: string;
  encrypted: boolean;
  mtimeMs: number;
  sizeBytes: number;
}

export interface UnitySaveReadResult {
  tree: RenpyVarNode | null;
  needsPassword: boolean;
  encrypted: boolean;
}
