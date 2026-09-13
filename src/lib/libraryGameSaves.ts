import * as ipc from './ipc';
import type { ExtraSaveRoot } from './ipc';
import * as library from './library';
import {
  resolveSaveEditorEngine,
  type SaveEditorEngine,
} from './saveEditorGate';
import type { LibraryGame } from '../types/library';

export type LibraryGameSavesSummary = {
  engine: SaveEditorEngine;
  /** All discovered slots (includes Unity registry). */
  totalCount: number;
  /** Slots delete-all will remove (excludes Unity registry). */
  deletableCount: number;
};

type SlotLike = { source?: string | null };

/** How many listed slots delete-all will actually remove. */
export function fileBackedSaveCount(
  engine: SaveEditorEngine,
  slots: SlotLike[],
): number {
  if (engine === 'unity') {
    return slots.filter((s) => s.source !== 'registry').length;
  }
  return slots.length;
}

async function extraRootsArg(threadId: string): Promise<ExtraSaveRoot[]> {
  const roots = await library.listSaveExtraRoots(threadId);
  return roots.map((r) => ({ id: r.id, path: r.path }));
}

async function resolveDeveloper(threadId: string): Promise<string | null> {
  try {
    const detail = await ipc.gameDetail(threadId);
    return detail.developer ?? null;
  } catch {
    return null;
  }
}

export async function summarizeLibraryGameSaves(
  game: Pick<LibraryGame, 'threadId' | 'installPath' | 'installStatus' | 'storeTags' | 'title'>,
): Promise<LibraryGameSavesSummary | null> {
  if (!game.installPath) return null;
  const engine = await resolveSaveEditorEngine({
    installStatus: game.installStatus,
    installPath: game.installPath,
    storeTags: game.storeTags,
  });
  if (!engine) return null;

  const extraRoots = await extraRootsArg(game.threadId);
  const slots =
    engine === 'unity'
      ? await ipc.unitySavesList(game.installPath, {
          developer: await resolveDeveloper(game.threadId),
          title: game.title,
          extraRoots,
        })
      : engine === 'rpgm'
        ? await ipc.rpgmSavesList(game.installPath, extraRoots)
        : engine === 'wolf'
          ? await ipc.wolfSavesList(game.installPath, extraRoots)
          : await ipc.renpySavesList(game.installPath, extraRoots);

  return {
    engine,
    totalCount: slots.length,
    deletableCount: fileBackedSaveCount(engine, slots),
  };
}

export async function deleteAllLibraryGameSaves(
  game: Pick<LibraryGame, 'threadId' | 'installPath' | 'installStatus' | 'storeTags' | 'title'>,
  engine: SaveEditorEngine,
  opts: { deleteBackups?: boolean } = {},
): Promise<number> {
  if (!game.installPath) return 0;
  const extraRoots = await extraRootsArg(game.threadId);
  const deleted =
    engine === 'unity'
      ? await ipc.unitySavesDeleteAll(game.installPath, {
          developer: await resolveDeveloper(game.threadId),
          title: game.title,
          extraRoots,
        })
      : engine === 'rpgm'
        ? await ipc.rpgmSavesDeleteAll(game.installPath, extraRoots)
        : engine === 'wolf'
          ? await ipc.wolfSavesDeleteAll(game.installPath, extraRoots)
          : await ipc.renpySavesDeleteAll(game.installPath, extraRoots);
  if (opts.deleteBackups) {
    await ipc.saveEditorBackupsDeleteAll(game.threadId);
  }
  return deleted;
}
