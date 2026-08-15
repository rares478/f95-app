import * as ipc from './ipc';
import { isRenPyEngine, isRpgmEngine } from './storeEngine';
import type { LibraryGame } from '../types/library';
import type { RenpyProbeResult, RenpySaveSlot } from '../types/renpySave';
import type { RpgmProbeResult } from '../types/rpgmSave';

export type SaveEditorEngine = 'renpy' | 'rpgm';

type SaveEditorGame = Pick<LibraryGame, 'installStatus' | 'installPath' | 'storeTags'>;

export type SaveEditorGateDeps = {
  renpyProbe?: (installPath: string) => Promise<RenpyProbeResult>;
  rpgmProbe?: (installPath: string) => Promise<RpgmProbeResult>;
  renpyList?: (installPath: string) => Promise<RenpySaveSlot[]>;
  rpgmList?: (installPath: string) => Promise<RenpySaveSlot[]>;
};

function defaultDeps(deps?: SaveEditorGateDeps): Required<SaveEditorGateDeps> {
  return {
    renpyProbe: deps?.renpyProbe ?? ipc.renpySavesProbe,
    rpgmProbe: deps?.rpgmProbe ?? ipc.rpgmSavesProbe,
    renpyList: deps?.renpyList ?? ipc.renpySavesList,
    rpgmList: deps?.rpgmList ?? ipc.rpgmSavesList,
  };
}

async function pickWhenBothHaveSaves(
  installPath: string,
  deps: Required<SaveEditorGateDeps>,
): Promise<SaveEditorEngine> {
  const [renpySettled, rpgmSettled] = await Promise.allSettled([
    deps.renpyList(installPath),
    deps.rpgmList(installPath),
  ]);
  const renpyHas =
    renpySettled.status === 'fulfilled' && renpySettled.value.length > 0;
  const rpgmHas =
    rpgmSettled.status === 'fulfilled' && rpgmSettled.value.length > 0;
  if (renpyHas && !rpgmHas) return 'renpy';
  if (rpgmHas && !renpyHas) return 'rpgm';
  // Tie / list failed: Ren'Py first per spec.
  return 'renpy';
}

async function resolveFromProbes(
  installPath: string,
  tags: { renpy: boolean; rpgm: boolean },
  deps: Required<SaveEditorGateDeps>,
): Promise<SaveEditorEngine | null> {
  const [renpy, rpgm] = await Promise.all([
    deps.renpyProbe(installPath),
    deps.rpgmProbe(installPath),
  ]);

  const renpyDir = renpy.savesDir != null;
  const rpgmDir = rpgm.savesDir != null;

  if (renpyDir && !rpgmDir) return 'renpy';
  if (rpgmDir && !renpyDir) return 'rpgm';
  if (renpyDir && rpgmDir) {
    return pickWhenBothHaveSaves(installPath, deps);
  }

  // No savesDir: layout flag, Ren'Py before RPGM.
  if (renpy.isRenpyLayout) return 'renpy';
  if (rpgm.isRpgmLayout) return 'rpgm';

  // No layout: tag fallback (both tags → Ren'Py first per spec).
  if (tags.renpy) return 'renpy';
  if (tags.rpgm) return 'rpgm';
  return null;
}

/** Resolve which save-editor engine applies, or null if none. */
export async function resolveSaveEditorEngine(
  game: SaveEditorGame,
  deps?: SaveEditorGateDeps,
): Promise<SaveEditorEngine | null> {
  if (game.installStatus !== 'installed' || !game.installPath) {
    return null;
  }

  const renpy = isRenPyEngine(game.storeTags);
  const rpgm = isRpgmEngine(game.storeTags);

  if (renpy && !rpgm) return 'renpy';
  if (rpgm && !renpy) return 'rpgm';

  return resolveFromProbes(game.installPath, { renpy, rpgm }, defaultDeps(deps));
}

/** Whether the Save Editor entry should be shown for an installed game. */
export async function shouldShowSaveEditor(
  game: SaveEditorGame,
  deps?: SaveEditorGateDeps,
): Promise<boolean> {
  return (await resolveSaveEditorEngine(game, deps)) != null;
}
