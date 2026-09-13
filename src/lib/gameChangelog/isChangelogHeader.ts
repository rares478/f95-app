import type { HeaderKind } from './types';

const MAX_HEADER_LEN = 100;

/** Optional v/V/. prefix + dotted numeric core, or Summertime-style wip.N. */
const VERSION_CORE = String.raw`(?:(?:[vV]\s*)?\.?\s*\d+(?:\.\d+)+[a-zA-Z]?|wip\.\d+)`;
const RE_VERSION_CORE = new RegExp(String.raw`^${VERSION_CORE}`, 'i');

const RE_DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Common forum dates: 26/06/2024 or 3/4/2024 */
const RE_DATE_SLASH = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const RE_CHAPTER = new RegExp(String.raw`^chapter\s+\d+\b.*${VERSION_CORE}`, 'i');
const RE_SEASON = new RegExp(String.raw`^season\s+\d+\b.*${VERSION_CORE}`, 'i');
const RE_SEASON_SOFT = /^season\s+\d+/i;
const RE_RELEASE_SOFT = /^(final|latest|release|current)$/i;
/** Bold "Changelog (wip.7944):" style labels (Summertime Saga). */
const RE_CHANGELOG_WIP = /^changelog\s*\(\s*wip\.\d+\s*\)/i;
/** Unbolded short suffixes allowed after a version core (DeLuca "Bugfix"). */
const RE_UNBOLD_VERSION_SUFFIX =
  /^(?:[-–—:]\s*.+|(?:bug\s*fixes?|remake|redux|hotfix|patch)(?:\s+\S+){0,2})$/i;

function isVersionTitle(trimmed: string, fromBold: boolean): boolean {
  const m = trimmed.match(RE_VERSION_CORE);
  if (!m) return false;
  const rest = trimmed.slice(m[0].length).trim();
  if (!rest) return true;
  if (fromBold) return true;
  return RE_UNBOLD_VERSION_SUFFIX.test(rest);
}

function hasVersionToken(s: string): boolean {
  return (
    new RegExp(VERSION_CORE, 'i').test(s) ||
    /\bv\s*\d+/i.test(s) ||
    /\b\d+\.\d+/.test(s)
  );
}

export function isChangelogHeader(
  text: string,
  opts?: { fromBold?: boolean },
): { ok: true; kind: HeaderKind } | { ok: false } {
  let trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_HEADER_LEN) {
    return { ok: false };
  }

  // Strip a single trailing colon (e.g. "v0.09.0:")
  if (trimmed.endsWith(':')) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }

  if (RE_DATE_ISO.test(trimmed)) {
    return { ok: true, kind: 'date' };
  }
  // Slash dates only when bold — body lines often repeat DD/MM/YYYY under a version.
  if (opts?.fromBold && RE_DATE_SLASH.test(trimmed)) {
    return { ok: true, kind: 'date' };
  }
  if (RE_CHAPTER.test(trimmed)) {
    return { ok: true, kind: 'chapter' };
  }
  if (RE_SEASON.test(trimmed)) {
    return { ok: true, kind: 'season' };
  }
  if (isVersionTitle(trimmed, !!opts?.fromBold)) {
    return { ok: true, kind: 'version' };
  }
  if (opts?.fromBold && RE_CHANGELOG_WIP.test(trimmed)) {
    return { ok: true, kind: 'version' };
  }
  // Bold Demo / Demo Translation release lines (Living With Sister, etc.)
  if (opts?.fromBold && /^demo\b/i.test(trimmed) && hasVersionToken(trimmed)) {
    return { ok: true, kind: 'version' };
  }
  if (opts?.fromBold && RE_SEASON_SOFT.test(trimmed)) {
    return { ok: true, kind: 'seasonSoft' };
  }
  if (opts?.fromBold && RE_RELEASE_SOFT.test(trimmed)) {
    return { ok: true, kind: 'releaseSoft' };
  }

  return { ok: false };
}
