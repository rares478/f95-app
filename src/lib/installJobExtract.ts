import { archiveBaseName, archiveParentDir } from './archives';

/** Strip chars that break path segments on Windows or POSIX (mirrors Rust sanitize_segment). */
export function sanitizePathSegment(s: string): string {
  const cleaned = s
    .replace(/\s*[\u00b7\u2022\u2013\u2014]\s*/g, ' - ')
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
  /** When >1, prefix section and suffix job id so concurrent extracts cannot collide. Single jobs use the archive stem (same folder as a manual extract). */
  jobCount?: number;
}): string {
  const gameDir = resolveLibraryGameDir(args.archivePath, args.installPath);
  const stem = sanitizePathSegment(archiveStem(args.archivePath));
  const section = sanitizePathSegment(args.sectionLabel);
  const multi = args.jobCount != null && args.jobCount > 1;
  const baseName = multi ? `${section}-${stem}` : stem;
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

/**
 * Shared extract folder for split-archive siblings (same bundleId).
 * Reuses a sibling's extractPath when present; otherwise
 * `{libraryGameDir}/{sanitize(sectionLabel)}` with no per-job / stem suffix.
 */
export function buildBundleExtractDest(args: {
  archivePath: string;
  sectionLabel: string;
  jobId: string;
  installPath?: string | null;
  siblingExtractPaths?: Iterable<string | null | undefined>;
}): string {
  for (const p of args.siblingExtractPaths ?? []) {
    if (p) return p;
  }
  const gameDir = resolveLibraryGameDir(args.archivePath, args.installPath);
  return joinPath(gameDir, sanitizePathSegment(args.sectionLabel));
}

/** Lead job for bundle assign-once: lowest sortOrder, then id. */
export function pickBundleLeadJob<T extends { id: string; sortOrder: number }>(
  jobs: readonly T[],
): T | null {
  if (jobs.length === 0) return null;
  return [...jobs].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  )[0]!;
}

/** True when any sibling has already been assigned (skip duplicate assign). */
export function bundleAlreadyAssigned(
  jobs: readonly { assignStatus: string }[],
): boolean {
  return jobs.some((j) => j.assignStatus === 'assigned');
}

/** Serialize assign-once / extract-once per bundle so concurrent finishes cannot race. */
function createBundleLock() {
  const locks = new Map<string, Promise<void>>();
  return async function withBundleLock<T>(
    bundleId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = locks.get(bundleId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = prev.then(() => gate);
    locks.set(bundleId, next);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(bundleId) === next) {
        locks.delete(bundleId);
      }
    }
  };
}

/** Serialize assign-once per bundle so concurrent finishing extracts cannot double-assign. */
export const withBundleAssignLock = createBundleLock();

/** Serialize extracts for the same bundleId (shared dest folder). */
export const withBundleExtractLock = createBundleLock();

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
/**
 * After a failed extract attempt, whether to mark the download/job failed.
 * Skip when this job already extracted (e.g. archive was deleted afterwards
 * and the user clicked Extract again).
 */
export function shouldRevertExtractFailure(
  job:
    | { extractPath: string | null; assignStatus: string }
    | null
    | undefined,
): boolean {
  if (!job) return true;
  if (job.extractPath) return false;
  if (job.assignStatus === 'assigned') return false;
  return true;
}

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
