import * as ipc from './ipc';
import { isRenPyEngine, isRpgmEngine, isUnityEngine } from './storeEngine';
import type { LibraryGame } from '../types/library';
import type { RenpyProbeResult, RenpySaveSlot } from '../types/renpySave';
import type { RpgmProbeResult } from '../types/rpgmSave';
import type { UnityProbeResult, UnitySaveSlot } from '../types/unitySave';

export type SaveEditorEngine = 'renpy' | 'rpgm' | 'unity';

type SaveEditorGame = Pick<LibraryGame, 'installStatus' | 'installPath' | 'storeTags'>;

export type SaveEditorGateDeps = {
  renpyProbe?: (installPath: string) => Promise<RenpyProbeResult>;
  rpgmProbe?: (installPath: string) => Promise<RpgmProbeResult>;
  unityProbe?: (installPath: string) => Promise<UnityProbeResult>;
  renpyList?: (installPath: string) => Promise<RenpySaveSlot[]>;
  rpgmList?: (installPath: string) => Promise<RenpySaveSlot[]>;
  unityList?: (installPath: string) => Promise<UnitySaveSlot[]>;
};

const ENGINE_TIE_ORDER: SaveEditorEngine[] = ['renpy', 'rpgm', 'unity'];

function defaultDeps(deps?: SaveEditorGateDeps): Required<SaveEditorGateDeps> {
  return {
    renpyProbe: deps?.renpyProbe ?? ipc.renpySavesProbe,
    rpgmProbe: deps?.rpgmProbe ?? ipc.rpgmSavesProbe,
    unityProbe: deps?.unityProbe ?? ((p) => ipc.unitySavesProbe(p)),
    renpyList: deps?.renpyList ?? ipc.renpySavesList,
    rpgmList: deps?.rpgmList ?? ipc.rpgmSavesList,
    unityList: deps?.unityList ?? ((p) => ipc.unitySavesList(p)),
  };
}

function firstByTieOrder(engines: SaveEditorEngine[]): SaveEditorEngine {
  for (const e of ENGINE_TIE_ORDER) {
    if (engines.includes(e)) return e;
  }
  return engines[0] ?? 'renpy';
}

async function pickAmongCandidates(
  installPath: string,
  candidates: SaveEditorEngine[],
  deps: Required<SaveEditorGateDeps>,
): Promise<SaveEditorEngine> {
  if (candidates.length === 1) return candidates[0]!;

  const listFns: Record<SaveEditorEngine, (p: string) => Promise<{ key: string }[]>> = {
    renpy: deps.renpyList,
    rpgm: deps.rpgmList,
    unity: deps.unityList,
  };

  const settled = await Promise.all(
    candidates.map(async (engine) => {
      const result = await Promise.allSettled([listFns[engine](installPath)]);
      const list = result[0]!;
      const has =
        list.status === 'fulfilled' && list.value.length > 0;
      return { engine, has };
    }),
  );

  const withSlots = settled.filter((s) => s.has).map((s) => s.engine);
  if (withSlots.length === 1) return withSlots[0]!;
  if (withSlots.length > 1) return firstByTieOrder(withSlots);
  // Tie / all lists empty or failed: Ren'Py → RPGM → Unity.
  return firstByTieOrder(candidates);
}

async function resolveFromProbes(
  installPath: string,
  tags: { renpy: boolean; rpgm: boolean; unity: boolean },
  deps: Required<SaveEditorGateDeps>,
): Promise<SaveEditorEngine | null> {
  // allSettled: one rejected probe must not hang / kill the others.
  const [renpySettled, rpgmSettled, unitySettled] = await Promise.allSettled([
    deps.renpyProbe(installPath),
    deps.rpgmProbe(installPath),
    deps.unityProbe(installPath),
  ]);
  const renpy =
    renpySettled.status === 'fulfilled' ? renpySettled.value : null;
  const rpgm =
    rpgmSettled.status === 'fulfilled' ? rpgmSettled.value : null;
  const unity =
    unitySettled.status === 'fulfilled' ? unitySettled.value : null;

  const withDir: SaveEditorEngine[] = [];
  if (renpy?.savesDir != null) withDir.push('renpy');
  if (rpgm?.savesDir != null) withDir.push('rpgm');
  if (unity?.localLowDir != null) withDir.push('unity');

  if (withDir.length > 0) {
    return pickAmongCandidates(installPath, withDir, deps);
  }

  // No saves root: layout flag, Ren'Py → RPGM → Unity.
  if (renpy?.isRenpyLayout) return 'renpy';
  if (rpgm?.isRpgmLayout) return 'rpgm';
  if (unity?.isUnityLayout) return 'unity';

  // No layout: tag fallback (multi-tag → Ren'Py → RPGM → Unity).
  if (tags.renpy) return 'renpy';
  if (tags.rpgm) return 'rpgm';
  if (tags.unity) return 'unity';
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
  const unity = isUnityEngine(game.storeTags);

  // Unambiguous tag fast-paths only.
  if (renpy && !rpgm && !unity) return 'renpy';
  if (rpgm && !renpy && !unity) return 'rpgm';
  if (unity && !renpy && !rpgm) return 'unity';

  return resolveFromProbes(
    game.installPath,
    { renpy, rpgm, unity },
    defaultDeps(deps),
  );
}

/** Whether the Save Editor entry should be shown for an installed game. */
export async function shouldShowSaveEditor(
  game: SaveEditorGame,
  deps?: SaveEditorGateDeps,
): Promise<boolean> {
  return (await resolveSaveEditorEngine(game, deps)) != null;
}
