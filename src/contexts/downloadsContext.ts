import { createContext, useContext } from 'react';
import type { GraphHistory } from '../lib/downloadSpeed';
import type { DownloadProgress, DownloadRow } from '../types/download';

export interface DownloadsContextValue {
  rows: DownloadRow[];
  progress: Record<number, DownloadProgress>;
  speedHistory: GraphHistory;
  reload: () => Promise<void>;
}

/** Separate module so Vite HMR does not recreate the context identity. */
export const DownloadsContext = createContext<DownloadsContextValue | null>(null);

export function useDownloads(): DownloadsContextValue {
  const ctx = useContext(DownloadsContext);
  if (!ctx) {
    throw new Error('useDownloads must be used within DownloadsProvider');
  }
  return ctx;
}
