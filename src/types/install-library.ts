/** A registered install location (Steam-style library folder). */
export interface InstallLibrary {
  id: number;
  label: string;
  path: string;
  /** Exactly one row in the table has this set. */
  isDefault: boolean;
  addedAt: string;
}

/** Disk info for a given path. Returned by ipc.diskInfo. */
export interface DiskInfo {
  freeBytes: number;
  /** Volume capacity in bytes; null when the backend could not read it. */
  totalBytes: number | null;
  /** false when the drive is unplugged / path doesn't exist. */
  available: boolean;
}

/** A library row augmented with live free-space info for UI rendering. */
export interface InstallLibraryWithDisk extends InstallLibrary {
  disk: DiskInfo;
  /** Total file size under the library folder; null while calculating or offline. */
  usedBytes: number | null;
}
