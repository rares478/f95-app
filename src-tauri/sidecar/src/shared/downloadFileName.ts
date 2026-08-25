import * as path from 'node:path';

/** Collapse path traversal / separators into a single safe filename segment. */
export function sanitizeDownloadFileName(name: string): string {
  const parts = name
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p.length > 0 && p !== '.' && p !== '..');
  const joined = parts.join('_').replace(/[<>:"|?*\u0000-\u001f]/g, '_');
  const trimmed = joined.trim() || 'download';
  // Ensure we never return a name that is still a path segment escape
  return trimmed.replace(/[/\\]/g, '_');
}

/**
 * Return `dir/fileName`, or `dir/base (n).ext` when the path already exists.
 * `exists` is injected so callers can use fs.existsSync (or a stub in tests).
 */
export function uniquifyFilePath(
  dir: string,
  fileName: string,
  exists: (p: string) => boolean,
): string {
  const candidate = path.join(dir, fileName);
  if (!exists(candidate)) return candidate;

  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let n = 1;
  for (;;) {
    const next = path.join(dir, `${base} (${n})${ext}`);
    if (!exists(next)) return next;
    n += 1;
  }
}
