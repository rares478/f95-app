import { archiveBaseName, archiveParentDir } from './archives';

/** Strip chars that break path segments on Windows or POSIX (mirrors Rust sanitize_segment). */
export function sanitizePathSegment(s: string): string {
  const cleaned = s
    .split('')
    .map((c) => {
      if ('/\\:*?"<>|'.includes(c)) return '_';
      if (c.charCodeAt(0) < 0x20) return '_';
      return c;
    })
    .join('');
  const trimmed = cleaned.replace(/^[\s.]+|[\s.]+$/g, '');
  return trimmed || 'download';
}

export function archiveStem(archivePath: string): string {
  const base = archiveBaseName(archivePath);
  const match = base.match(/^(.+)\.(zip|7z|rar)$/i);
  return match ? match[1] : base || 'extracted';
}

export function joinPath(root: string, part: string): string {
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[/\\]+$/, '')}${sep}${part}`;
}

export function parentDir(path: string): string | null {
  const trimmed = path.replace(/[/\\]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx <= 0) return null;
  return trimmed.slice(0, idx);
}

function normalizePath(p: string): string {
  return p.trim().replace(/[/\\]+$/, '').toLowerCase();
}

/**
 * Game folder under the install library for job extracts.
 * Prefer the archive's thread folder; if install_path lives elsewhere, use its parent.
 */
export function resolveLibraryGameDir(
  archivePath: string,
  installPath: string | null | undefined,
): string {
  const archiveParent = archiveParentDir(archivePath);
  if (!installPath) return archiveParent;

  const installNorm = normalizePath(installPath);
  const archiveNorm = normalizePath(archiveParent);
  if (
    installNorm === archiveNorm ||
    installNorm.startsWith(`${archiveNorm}/`) ||
    installNorm.startsWith(`${archiveNorm}\\`)
  ) {
    return archiveParent;
  }

  return parentDir(installPath) ?? archiveParent;
}

export function shortJobId(jobId: string): string {
  return jobId.replace(/-/g, '').slice(0, 8) || jobId.slice(0, 8);
}

export function buildJobExtractDest(args: {
  archivePath: string;
  sectionLabel: string;
  jobId: string;
  installPath?: string | null;
  /** Other jobs' extract paths that must not be reused. */
  takenPaths?: Iterable<string | null | undefined>;
  /** When >1, always suffix so concurrent extracts cannot collide. */
  jobCount?: number;
}): string {
  const gameDir = resolveLibraryGameDir(args.archivePath, args.installPath);
  const baseName = `${sanitizePathSegment(args.sectionLabel)}-${sanitizePathSegment(
    archiveStem(args.archivePath),
  )}`;
  const primary = joinPath(gameDir, baseName);
  const taken = new Set(
    [...(args.takenPaths ?? [])]
      .filter((p): p is string => !!p)
      .map(normalizePath),
  );
  const needsSuffix =
    (args.jobCount != null && args.jobCount > 1) ||
    taken.has(normalizePath(primary));

  if (!needsSuffix) return primary;
  return joinPath(gameDir, `${baseName}-${shortJobId(args.jobId)}`);
}

export const INSTALL_NEEDS_ASSIGN_EVENT = 'install:needs-assign';

export interface InstallNeedsAssignDetail {
  jobId: string;
  planId: string;
  threadId: string;
  /** Detected main exe from extract; null when none found. */
  exePath?: string | null;
}

export function emitInstallNeedsAssign(detail: InstallNeedsAssignDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(INSTALL_NEEDS_ASSIGN_EVENT, { detail }),
  );
}

const TERMINAL_ASSIGN_STATUSES = new Set(['assigned', 'skipped', 'failed']);

/**
 * Whether reconcile / auto-extract may run for a completed download.
 * Job-linked extracts leave library `not_installed` until Assign; once a job
 * already has an extract path (or a terminal assign status), do not re-extract.
 */
export function shouldAutoExtractDownload(args: {
  job:
    | { extractPath: string | null; assignStatus: string }
    | null
    | undefined;
}): boolean {
  const { job } = args;
  if (!job) return true;
  if (job.extractPath) return false;
  if (TERMINAL_ASSIGN_STATUSES.has(job.assignStatus)) return false;
  return true;
}
