import * as ipc from './ipc';
import { isRenPyEngine } from './storeEngine';
import type { LibraryGame } from '../types/library';
import type { RenpyProbeResult } from '../types/renpySave';

type SaveEditorGame = Pick<LibraryGame, 'installStatus' | 'installPath' | 'storeTags'>;

type RenpyProbeFn = (installPath: string) => Promise<RenpyProbeResult>;

/** Whether the Save Editor entry should be shown for an installed game. */
export async function shouldShowSaveEditor(
  game: SaveEditorGame,
  probe: RenpyProbeFn = ipc.renpySavesProbe,
): Promise<boolean> {
  if (game.installStatus !== 'installed' || !game.installPath) {
    return false;
  }
  if (isRenPyEngine(game.storeTags)) {
    return true;
  }
  const result = await probe(game.installPath);
  return result.isRenpyLayout;
}
