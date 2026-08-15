export type DownloadState =
  | 'pending'
  | 'resolving'
  | 'awaiting_choice'
  | 'downloading'
  | 'extracting'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'needs_browser';

export interface DownloadRow {
  id: number;
  threadId: string;
  host: string;
  sourceUrl: string;
  resolvedUrl: string | null;
  destPath: string | null;
  /** Install library folder this download was routed into. */
  libraryPath: string | null;
  state: DownloadState;
  bytesTotal: number | null;
  bytesDone: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** F95 version captured at click-time. Applied to library after extract. */
  gameVersion: string | null;
}

/** Live progress that doesn't merit a DB write each tick. */
export interface DownloadProgress {
  id: number;
  bytes: number;
  total: number | null;
  speedBps: number;
  /** Set while `extract:progress` events stream from the backend. */
  extractPercent?: number | null;
  extractEtaSecs?: number | null;
}

/** Translation key for a download state. Pair with `t()`. */
export function stateKey(s: DownloadState): string {
  return `dlstate.${s}`;
}

export function stateColor(s: DownloadState): string {
  switch (s) {
    case 'completed':
      return 'var(--status-success)';
    case 'downloading':
      return 'var(--status-info)';
    case 'extracting':
      return 'var(--status-purple)';
    case 'resolving':
    case 'pending':
    case 'awaiting_choice':
      return 'var(--status-warning)';
    case 'failed':
      return 'var(--accent-strong)';
    case 'cancelled':
      return 'var(--text-faint)';
    case 'needs_browser':
      return 'var(--status-purple)';
  }
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || isNaN(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

export function formatEta(bytesLeft: number, bps: number): string {
  if (bps <= 0) return '—';
  const sec = Math.max(0, Math.round(bytesLeft / bps));
  return formatDuration(sec);
}

export function formatDuration(sec: number): string {
  if (sec <= 0) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
