import type { DownloadRow } from '../types/download';

export function canPauseDownload(row: DownloadRow): boolean {
  const host = row.host.trim().toLowerCase();
  if (host === 'mega') return false;
  return row.state === 'downloading' || row.state === 'resolving';
}

/** Matches Rust `with_part_ext`: foo.zip → foo.zip.part */
export function partPathForDest(destPath: string): string {
  return `${destPath}.part`;
}
