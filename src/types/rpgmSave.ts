export interface RpgmProbeResult {
  isRpgmLayout: boolean;
  savesDir: string | null;
  /** `"mv"` | `"mz"` when layout detected */
  variant: string | null;
}
