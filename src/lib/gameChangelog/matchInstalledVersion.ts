import type { GameChangelogEntry } from './types';

const VERSION_CORE = /\d+(?:\.\d+)+[a-z]?/i;

const SOFT_TRAILING =
  /(?:\s*[-–—:]?\s*(?:remake|redux|bug\s*fixes?|build\s+\d+|chapter\s+\d+))+$/i;

/** Trim, lower-case, strip leading v/., collapse spaces, strip soft trailing tokens. */
export function normalizeChangelogVersion(s: string): string {
  let out = s.trim().toLowerCase();
  out = out.replace(/^[v.]+/i, '');
  out = out.replace(/\s+/g, ' ').trim();
  out = out.replace(SOFT_TRAILING, '').trim();
  out = out.replace(/[:.\s]+$/g, '').trim();
  return out;
}

function extractVersionCore(s: string): string | null {
  const m = s.match(VERSION_CORE);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Index of best-matching changelog entry for `currentVersion`, or `-1`.
 * Prefer first (newest) on ties.
 */
export function matchInstalledVersion(
  entries: GameChangelogEntry[],
  currentVersion: string | null | undefined,
): number {
  if (currentVersion == null || String(currentVersion).trim() === '') {
    return -1;
  }

  const installedNorm = normalizeChangelogVersion(currentVersion);
  const installedCore =
    extractVersionCore(installedNorm) ?? extractVersionCore(String(currentVersion));

  for (let i = 0; i < entries.length; i++) {
    const titleNorm = normalizeChangelogVersion(entries[i].title);
    if (titleNorm === installedNorm) {
      return i;
    }
  }

  if (!installedCore) {
    return -1;
  }

  for (let i = 0; i < entries.length; i++) {
    const titleNorm = normalizeChangelogVersion(entries[i].title);
    const titleCore =
      extractVersionCore(titleNorm) ?? extractVersionCore(entries[i].title);
    // Exact core only — avoid `0.6` matching `v0.6.1` via naive includes.
    if (titleCore === installedCore) {
      return i;
    }
  }

  return -1;
}
