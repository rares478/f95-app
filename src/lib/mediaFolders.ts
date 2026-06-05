import { naturalSortBy } from './naturalSort';
import type { MediaViewItem } from '../types/media';

export interface MediaFolderGroup {
  /** Directory path relative to install root (may contain nested segments). */
  relPrefix: string;
  label: string;
  items: MediaViewItem[];
}

const MAX_UNWRAP = 6;

/** True when the sidebar should show folder pickers before file/page lists. */
export function shouldUseFolderNav(folders: MediaFolderGroup[]): boolean {
  if (folders.length === 0) return false;
  if (folders.some((f) => f.relPrefix !== '')) return true;
  return folders.length > 1;
}

/**
 * Group media by each file's parent directory under `installPath` (supports nested subfolders).
 * Unwraps a single wrapper directory (common in zips) until multiple groups appear.
 */
export function groupMediaIntoFolders(
  items: MediaViewItem[],
  installPath: string,
  rootLabel: string,
): MediaFolderGroup[] {
  if (items.length === 0) return [];

  let base = normalizePath(installPath);
  let pool = items;

  for (let depth = 0; depth < MAX_UNWRAP; depth++) {
    const unwrapBuckets = bucketByFirstSegment(pool, base);
    const rootItems = unwrapBuckets.get('') ?? [];
    const folderKeys = [...unwrapBuckets.keys()].filter((k) => k !== '');

    if (folderKeys.length === 1 && rootItems.length === 0) {
      const only = folderKeys[0];
      base = `${base}/${only}`;
      pool = unwrapBuckets.get(only) ?? [];
      continue;
    }

    const dirBuckets = bucketByRelativeDir(pool, base);
    const rootDirItems = dirBuckets.get('') ?? [];
    const dirKeys = [...dirBuckets.keys()].filter((k) => k !== '');

    const folders: MediaFolderGroup[] = [];
    if (rootDirItems.length > 0) {
      const relPrefix = relPrefixFromInstall(installPath, base, '');
      folders.push({
        relPrefix,
        label: folderDisplayLabel('', relPrefix, rootLabel),
        items: naturalSortBy(rootDirItems, (i) => i.path.replace(/\\/g, '/')),
      });
    }
    for (const relDir of naturalSortBy(dirKeys, (k) => k)) {
      const groupItems = dirBuckets.get(relDir) ?? [];
      const relPrefix = relPrefixFromInstall(installPath, base, relDir);
      folders.push({
        relPrefix,
        label: folderDisplayLabel(relDir, relPrefix, rootLabel),
        items: naturalSortBy(groupItems, (i) => i.path.replace(/\\/g, '/')),
      });
    }
    return folders;
  }

  const relPrefix = '';
  return [
    {
      relPrefix,
      label: folderDisplayLabel('', relPrefix, rootLabel),
      items: naturalSortBy(pool, (i) => i.path.replace(/\\/g, '/')),
    },
  ];
}

export function folderForPath(
  folders: MediaFolderGroup[],
  installPath: string,
  filePath: string,
): MediaFolderGroup | undefined {
  const direct = folders.find((f) => f.items.some((i) => i.path === filePath));
  if (direct) return direct;

  const norm = normalizePath(filePath).toLowerCase();
  const install = normalizePath(installPath).toLowerCase();
  let best: MediaFolderGroup | undefined;
  let bestLen = -1;

  for (const folder of folders) {
    if (!folder.relPrefix) {
      const rel = norm.startsWith(`${install}/`) ? norm.slice(install.length + 1) : '';
      const slash = rel.indexOf('/');
      const inInstallRoot = rel && slash < 0;
      if (inInstallRoot) {
        if (install.length > bestLen) {
          best = folder;
          bestLen = install.length;
        }
      }
      continue;
    }
    const prefix = `${install}/${folder.relPrefix.toLowerCase()}`;
    if (norm === prefix || norm.startsWith(`${prefix}/`)) {
      if (prefix.length > bestLen) {
        best = folder;
        bestLen = prefix.length;
      }
    }
  }
  return best ?? folders[0];
}

/** Group by first path segment (used only to unwrap single wrapper folders). */
function bucketByFirstSegment(
  items: MediaViewItem[],
  basePath: string,
): Map<string, MediaViewItem[]> {
  const base = normalizePath(basePath);
  const baseLower = base.toLowerCase();
  const map = new Map<string, MediaViewItem[]>();

  for (const item of items) {
    const rel = relativeFileToBase(item.path, base, baseLower);
    const segments = rel.split('/').filter(Boolean);
    const key = segments.length <= 1 ? '' : segments[0];
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/** Group by parent directory relative to `basePath` (supports arbitrary nesting). */
function bucketByRelativeDir(
  items: MediaViewItem[],
  basePath: string,
): Map<string, MediaViewItem[]> {
  const base = normalizePath(basePath);
  const baseLower = base.toLowerCase();
  const map = new Map<string, MediaViewItem[]>();

  for (const item of items) {
    const relDir = relativeDirOfFile(item.path, base, baseLower);
    const list = map.get(relDir);
    if (list) list.push(item);
    else map.set(relDir, [item]);
  }
  return map;
}

function relativeDirOfFile(filePath: string, base: string, baseLower: string): string {
  const rel = relativeFileToBase(filePath, base, baseLower);
  const parts = rel.split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}

function relPrefixFromInstall(
  installPath: string,
  currentBase: string,
  relDir: string,
): string {
  const install = normalizePath(installPath);
  const base = normalizePath(currentBase);
  const relBase = base.slice(install.length).replace(/^\/+/, '');
  if (!relDir) {
    if (base.toLowerCase() === install.toLowerCase()) return '';
    return relBase;
  }
  return relBase ? `${relBase}/${relDir}` : relDir;
}

function folderDisplayLabel(relDir: string, relPrefix: string, rootLabel: string): string {
  if (relDir) return relDir;
  if (!relPrefix) return rootLabel;
  const parts = relPrefix.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? rootLabel;
}

function relativeFileToBase(filePath: string, base: string, baseLower: string): string {
  const norm = normalizePath(filePath);
  const lower = norm.toLowerCase();
  if (lower === baseLower) return norm.split('/').pop() ?? norm;
  const prefix = `${baseLower}/`;
  if (!lower.startsWith(prefix)) return norm;
  return norm.slice(base.length + 1);
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}
