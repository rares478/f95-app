export const ARCHIVE_EXT_RE = /\.(zip|7z|rar)$/i;

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'KiB', 'MiB', 'GiB'] as const;

function isHumanSizeLabel(text: string): boolean {
  const t = text.trim().toUpperCase();
  for (const unit of SIZE_UNITS) {
    if (t.endsWith(unit)) {
      const num = t.slice(0, -unit.length).trim().replace(/,/g, '');
      if (num.length > 0 && /^[\d.]+$/.test(num)) return true;
    }
  }
  return false;
}

/** Strip hosting-site suffixes like " (520.47 MB)" from a download filename. */
export function cleanDownloadFileName(name: string): string {
  let cleaned = name.trim();
  for (let i = 0; i < 3; i += 1) {
    const next = stripOneTrailingSizeLabel(cleaned);
    if (next === cleaned) break;
    cleaned = next;
  }
  return cleaned;
}

function stripOneTrailingSizeLabel(name: string): string {
  const trimmed = name.trimEnd();
  const parenOpen = trimmed.lastIndexOf(' (');
  if (parenOpen > 0 && trimmed.endsWith(')')) {
    const inner = trimmed.slice(parenOpen + 2, -1).trim();
    if (isHumanSizeLabel(inner)) {
      return trimmed.slice(0, parenOpen).trimEnd();
    }
  }
  const dashIdx = trimmed.lastIndexOf(' - ');
  if (dashIdx > 0) {
    const inner = trimmed.slice(dashIdx + 3).trim();
    if (isHumanSizeLabel(inner)) {
      return trimmed.slice(0, dashIdx).trimEnd();
    }
  }
  return name;
}

export function archiveBaseName(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  return cleanDownloadFileName(base);
}

export function isArchivePath(path: string): boolean {
  return ARCHIVE_EXT_RE.test(archiveBaseName(path));
}

/** Folder `extract_archive` creates next to the archive (stem name). */
export function extractDirForArchive(archivePath: string): string {
  const base = archiveBaseName(archivePath);
  const match = base.match(/^(.+)\.(zip|7z|rar)$/i);
  if (!match) return archivePath;
  const parent = archiveParentDir(archivePath);
  const sep = archivePath.includes('\\') ? '\\' : '/';
  return `${parent}${sep}${match[1]}`;
}

export function archiveParentDir(archivePath: string): string {
  return archivePath.replace(/[/\\][^\\/]+$/, '');
}
