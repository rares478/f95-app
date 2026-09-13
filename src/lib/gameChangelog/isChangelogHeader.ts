import type { HeaderKind } from './types';

const MAX_HEADER_LEN = 100;

/** Optional v/V/. prefix + dotted numeric core (e.g. 0.6.1, 0.06.5, 1.07.3c). */
const VERSION_CORE = String.raw`(?:[vV]\s*)?\.?\s*\d+(?:\.\d+)+[a-zA-Z]?`;

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_CHAPTER = new RegExp(String.raw`^chapter\s+\d+\b.*${VERSION_CORE}`, 'i');
const RE_SEASON = new RegExp(String.raw`^season\s+\d+\b.*${VERSION_CORE}`, 'i');
const RE_VERSION = new RegExp(String.raw`^${VERSION_CORE}(?:\s.*)?$`);
const RE_SEASON_SOFT = /^season\s+\d+/i;

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

  if (RE_DATE.test(trimmed)) {
    return { ok: true, kind: 'date' };
  }
  if (RE_CHAPTER.test(trimmed)) {
    return { ok: true, kind: 'chapter' };
  }
  if (RE_SEASON.test(trimmed)) {
    return { ok: true, kind: 'season' };
  }
  if (RE_VERSION.test(trimmed)) {
    return { ok: true, kind: 'version' };
  }
  if (opts?.fromBold && RE_SEASON_SOFT.test(trimmed)) {
    return { ok: true, kind: 'seasonSoft' };
  }

  return { ok: false };
}
