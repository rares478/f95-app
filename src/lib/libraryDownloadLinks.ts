import type { GameDownload, GameDetail } from '../types/game';
import type { LibraryGame } from '../types/library';
import * as library from './library';
import * as ipc from './ipc';

export type LinkIntent = 'install' | 'update';

function normalizeVersion(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^v(?=\d)/, '');
}

function versionsEqual(a: string, b: string): boolean {
  return normalizeVersion(a) === normalizeVersion(b);
}

export function targetLinksVersion(
  game: LibraryGame,
  intent: LinkIntent,
): string | null {
  if (intent === 'update') {
    return game.availableVersion?.trim() || null;
  }
  return (
    game.availableVersion?.trim() ||
    game.currentVersion?.trim() ||
    null
  );
}

export function linksAreStale(game: LibraryGame, intent: LinkIntent): boolean {
  if (!game.downloadLinks || game.downloadLinks.length === 0) return true;
  const target = targetLinksVersion(game, intent);
  if (!target) return false;
  const stamped = game.downloadLinksVersion?.trim();
  if (!stamped) return true;
  return !versionsEqual(stamped, target);
}

export async function saveLinksFromDetail(
  threadId: string,
  detail: GameDetail,
): Promise<void> {
  const version = (detail.version ?? '').trim() || null;
  await saveLinksSnapshot(threadId, detail.downloads ?? [], version);
}

export async function saveLinksSnapshot(
  threadId: string,
  links: GameDownload[],
  version: string | null,
): Promise<void> {
  await library.setDownloadLinks(threadId, links, version);
}

export class LibraryLinksError extends Error {
  constructor(
    public readonly code: 'fetch_failed' | 'empty_links',
    message: string,
  ) {
    super(message);
    this.name = 'LibraryLinksError';
  }
}

export async function ensureLinks(
  game: LibraryGame,
  intent: LinkIntent,
): Promise<GameDownload[]> {
  if (!linksAreStale(game, intent)) {
    return game.downloadLinks;
  }
  let detail: GameDetail;
  try {
    detail = await ipc.gameDetail(game.threadId);
  } catch (err) {
    const msg =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : String(err);
    throw new LibraryLinksError('fetch_failed', msg);
  }
  await saveLinksFromDetail(game.threadId, detail);
  const links = detail.downloads ?? [];
  if (links.length === 0) {
    throw new LibraryLinksError('empty_links', 'No download links found');
  }
  return links;
}
