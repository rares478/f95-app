import { describe, expect, it, vi } from 'vitest';
import { resolveSaveEditorEngine, shouldShowSaveEditor } from './saveEditorGate';
import type { RenpyProbeResult } from '../types/renpySave';
import type { RpgmProbeResult } from '../types/rpgmSave';
import type { UnityProbeResult } from '../types/unitySave';
import type { LibraryGame } from '../types/library';

type GateGame = Pick<LibraryGame, 'installStatus' | 'installPath' | 'storeTags'>;

function game(over: Partial<GateGame> = {}): GateGame {
  return {
    installStatus: 'installed',
    installPath: 'D:/Games/Example',
    storeTags: [],
    ...over,
  };
}

function renpyProbeResult(over: Partial<RenpyProbeResult> = {}): RenpyProbeResult {
  return {
    isRenpyLayout: false,
    savesDir: null,
    ...over,
  };
}

function rpgmProbeResult(over: Partial<RpgmProbeResult> = {}): RpgmProbeResult {
  return {
    isRpgmLayout: false,
    savesDir: null,
    variant: null,
    ...over,
  };
}

function unityProbeResult(over: Partial<UnityProbeResult> = {}): UnityProbeResult {
  return {
    isUnityLayout: false,
    localLowDir: null,
    company: null,
    product: null,
    ...over,
  };
}

describe('shouldShowSaveEditor / resolveSaveEditorEngine', () => {
  it("is renpy when store tags indicate Ren'Py only (no probe)", async () => {
    const renpyProbe = vi.fn();
    const rpgmProbe = vi.fn();
    const unityProbe = vi.fn();
    const engine = await resolveSaveEditorEngine(game({ storeTags: ["Ren'Py"] }), {
      renpyProbe,
      rpgmProbe,
      unityProbe,
    });
    expect(engine).toBe('renpy');
    expect(await shouldShowSaveEditor(game({ storeTags: ["Ren'Py"] }), { renpyProbe, rpgmProbe, unityProbe })).toBe(
      true,
    );
    expect(renpyProbe).not.toHaveBeenCalled();
    expect(rpgmProbe).not.toHaveBeenCalled();
    expect(unityProbe).not.toHaveBeenCalled();
  });

  it('is rpgm when store tags indicate RPGM only (no probe)', async () => {
    const renpyProbe = vi.fn();
    const rpgmProbe = vi.fn();
    const unityProbe = vi.fn();
    const engine = await resolveSaveEditorEngine(game({ storeTags: ['RPGM'] }), {
      renpyProbe,
      rpgmProbe,
      unityProbe,
    });
    expect(engine).toBe('rpgm');
    expect(await shouldShowSaveEditor(game({ storeTags: ['rpgm'] }), { renpyProbe, rpgmProbe, unityProbe })).toBe(
      true,
    );
    expect(renpyProbe).not.toHaveBeenCalled();
    expect(rpgmProbe).not.toHaveBeenCalled();
    expect(unityProbe).not.toHaveBeenCalled();
  });

  it('resolves unity when only Unity tag', async () => {
    const renpyProbe = vi.fn();
    const rpgmProbe = vi.fn();
    const unityProbe = vi.fn();
    await expect(
      resolveSaveEditorEngine(
        {
          installStatus: 'installed',
          installPath: 'C:/g',
          storeTags: ['Unity'],
        },
        { renpyProbe, rpgmProbe, unityProbe },
      ),
    ).resolves.toBe('unity');
    expect(renpyProbe).not.toHaveBeenCalled();
    expect(rpgmProbe).not.toHaveBeenCalled();
    expect(unityProbe).not.toHaveBeenCalled();
  });

  it("is true when tags miss but Ren'Py probe finds layout", async () => {
    const renpyProbe = vi.fn().mockResolvedValue(
      renpyProbeResult({ isRenpyLayout: true, savesDir: 'D:/Games/HiddenRenpy/game/saves' }),
    );
    const rpgmProbe = vi.fn().mockResolvedValue(rpgmProbeResult());
    const unityProbe = vi.fn().mockResolvedValue(unityProbeResult());
    const result = await shouldShowSaveEditor(
      game({ storeTags: [], installPath: 'D:/Games/HiddenRenpy' }),
      { renpyProbe, rpgmProbe, unityProbe },
    );
    expect(result).toBe(true);
    expect(await resolveSaveEditorEngine(
      game({ storeTags: [], installPath: 'D:/Games/HiddenRenpy' }),
      { renpyProbe, rpgmProbe, unityProbe },
    )).toBe('renpy');
    expect(renpyProbe).toHaveBeenCalledWith('D:/Games/HiddenRenpy');
    expect(rpgmProbe).toHaveBeenCalledWith('D:/Games/HiddenRenpy');
    expect(unityProbe).toHaveBeenCalledWith('D:/Games/HiddenRenpy');
  });

  it('is rpgm when tags miss but RPGM probe finds savesDir', async () => {
    const renpyProbe = vi.fn().mockResolvedValue(renpyProbeResult());
    const rpgmProbe = vi.fn().mockResolvedValue(
      rpgmProbeResult({ isRpgmLayout: true, savesDir: 'D:/Games/Rpg/www/save', variant: 'mz' }),
    );
    const unityProbe = vi.fn().mockResolvedValue(unityProbeResult());
    expect(
      await resolveSaveEditorEngine(game({ storeTags: [] }), { renpyProbe, rpgmProbe, unityProbe }),
    ).toBe('rpgm');
  });

  it('is unity when tags miss but Unity probe finds layout', async () => {
    const renpyProbe = vi.fn().mockResolvedValue(renpyProbeResult());
    const rpgmProbe = vi.fn().mockResolvedValue(rpgmProbeResult());
    const unityProbe = vi.fn().mockResolvedValue(
      unityProbeResult({ isUnityLayout: true, localLowDir: 'D:/ll/Co/Game' }),
    );
    expect(
      await resolveSaveEditorEngine(game({ storeTags: [] }), { renpyProbe, rpgmProbe, unityProbe }),
    ).toBe('unity');
  });

  it('is false when not installed', async () => {
    const renpyProbe = vi.fn().mockResolvedValue(renpyProbeResult({ isRenpyLayout: true }));
    const rpgmProbe = vi.fn();
    const unityProbe = vi.fn();
    const result = await shouldShowSaveEditor(
      game({
        installStatus: 'not_installed',
        installPath: 'D:/Games/Example',
        storeTags: ["Ren'Py"],
      }),
      { renpyProbe, rpgmProbe, unityProbe },
    );
    expect(result).toBe(false);
    expect(renpyProbe).not.toHaveBeenCalled();
    expect(rpgmProbe).not.toHaveBeenCalled();
    expect(unityProbe).not.toHaveBeenCalled();
  });

  it('is false when installed without installPath', async () => {
    const renpyProbe = vi.fn();
    const rpgmProbe = vi.fn();
    const unityProbe = vi.fn();
    const result = await shouldShowSaveEditor(
      game({ installPath: null, storeTags: ['RPGM'] }),
      { renpyProbe, rpgmProbe, unityProbe },
    );
    expect(result).toBe(false);
    expect(renpyProbe).not.toHaveBeenCalled();
    expect(rpgmProbe).not.toHaveBeenCalled();
    expect(unityProbe).not.toHaveBeenCalled();
  });

  it('is false when tags miss and neither probe finds a layout', async () => {
    const renpyProbe = vi.fn().mockResolvedValue(renpyProbeResult());
    const rpgmProbe = vi.fn().mockResolvedValue(rpgmProbeResult());
    const unityProbe = vi.fn().mockResolvedValue(unityProbeResult());
    const result = await shouldShowSaveEditor(game({ storeTags: ['Adventure'] }), {
      renpyProbe,
      rpgmProbe,
      unityProbe,
    });
    expect(result).toBe(false);
    expect(renpyProbe).toHaveBeenCalledOnce();
    expect(rpgmProbe).toHaveBeenCalledOnce();
    expect(unityProbe).toHaveBeenCalledOnce();
  });

  it("prefers Ren'Py when both tags and both probes have savesDir (tie → renpy)", async () => {
    const renpyProbe = vi.fn().mockResolvedValue(
      renpyProbeResult({ isRenpyLayout: true, savesDir: 'D:/a/saves' }),
    );
    const rpgmProbe = vi.fn().mockResolvedValue(
      rpgmProbeResult({ isRpgmLayout: true, savesDir: 'D:/a/save', variant: 'mv' }),
    );
    const unityProbe = vi.fn().mockResolvedValue(unityProbeResult());
    const renpyList = vi.fn().mockResolvedValue([{ key: '1' }, { key: '2' }]);
    const rpgmList = vi.fn().mockResolvedValue([{ key: 'file1' }]);
    const unityList = vi.fn();
    expect(
      await resolveSaveEditorEngine(game({ storeTags: ["Ren'Py", 'RPGM'] }), {
        renpyProbe,
        rpgmProbe,
        unityProbe,
        renpyList,
        rpgmList,
        unityList,
      }),
    ).toBe('renpy');
    expect(renpyProbe).toHaveBeenCalledOnce();
    expect(rpgmProbe).toHaveBeenCalledOnce();
    expect(unityProbe).toHaveBeenCalledOnce();
    expect(renpyList).toHaveBeenCalledOnce();
    expect(rpgmList).toHaveBeenCalledOnce();
    expect(unityList).not.toHaveBeenCalled();
  });

  it('prefers engine with non-empty save list when both have savesDir', async () => {
    const renpyProbe = vi.fn().mockResolvedValue(
      renpyProbeResult({ isRenpyLayout: true, savesDir: 'D:/a/saves' }),
    );
    const rpgmProbe = vi.fn().mockResolvedValue(
      rpgmProbeResult({ isRpgmLayout: true, savesDir: 'D:/a/save', variant: 'mz' }),
    );
    const unityProbe = vi.fn().mockResolvedValue(unityProbeResult());
    expect(
      await resolveSaveEditorEngine(game({ storeTags: [] }), {
        renpyProbe,
        rpgmProbe,
        unityProbe,
        renpyList: vi.fn().mockResolvedValue([]),
        rpgmList: vi.fn().mockResolvedValue([{ key: 'file1' }]),
        unityList: vi.fn().mockResolvedValue([]),
      }),
    ).toBe('rpgm');
  });

  it('prefers engine with slots when unity and renpy both probe', async () => {
    const renpyProbe = vi.fn().mockResolvedValue(
      renpyProbeResult({ isRenpyLayout: true, savesDir: 'D:/a/saves' }),
    );
    const rpgmProbe = vi.fn().mockResolvedValue(rpgmProbeResult());
    const unityProbe = vi.fn().mockResolvedValue(
      unityProbeResult({ isUnityLayout: true, localLowDir: 'D:/ll/Co/Prod' }),
    );
    const renpyList = vi.fn().mockResolvedValue([]);
    const rpgmList = vi.fn();
    const unityList = vi.fn().mockResolvedValue([{ key: 'install:save.es3' }]);
    expect(
      await resolveSaveEditorEngine(game({ storeTags: [] }), {
        renpyProbe,
        rpgmProbe,
        unityProbe,
        renpyList,
        rpgmList,
        unityList,
      }),
    ).toBe('unity');
    expect(renpyList).toHaveBeenCalledOnce();
    expect(unityList).toHaveBeenCalledOnce();
    expect(rpgmList).not.toHaveBeenCalled();
  });

  it('tie-breaks renpy over unity when both have slots', async () => {
    const renpyProbe = vi.fn().mockResolvedValue(
      renpyProbeResult({ isRenpyLayout: true, savesDir: 'D:/a/saves' }),
    );
    const rpgmProbe = vi.fn().mockResolvedValue(rpgmProbeResult());
    const unityProbe = vi.fn().mockResolvedValue(
      unityProbeResult({ isUnityLayout: true, localLowDir: 'D:/ll/Co/Prod' }),
    );
    expect(
      await resolveSaveEditorEngine(game({ storeTags: [] }), {
        renpyProbe,
        rpgmProbe,
        unityProbe,
        renpyList: vi.fn().mockResolvedValue([{ key: '1' }]),
        rpgmList: vi.fn(),
        unityList: vi.fn().mockResolvedValue([{ key: 'install:save.es3' }]),
      }),
    ).toBe('renpy');
  });

  it('resolves when one probe rejects (does not hang on the other)', async () => {
    const renpyProbe = vi.fn().mockRejectedValue(new Error('renpy probe failed'));
    const rpgmProbe = vi.fn().mockResolvedValue(
      rpgmProbeResult({ isRpgmLayout: true, savesDir: 'D:/Games/Rpg/www/save', variant: 'mv' }),
    );
    const unityProbe = vi.fn().mockRejectedValue(new Error('unity probe failed'));
    await expect(
      resolveSaveEditorEngine(game({ storeTags: [] }), { renpyProbe, rpgmProbe, unityProbe }),
    ).resolves.toBe('rpgm');
    expect(renpyProbe).toHaveBeenCalledOnce();
    expect(rpgmProbe).toHaveBeenCalledOnce();
    expect(unityProbe).toHaveBeenCalledOnce();
  });

  it('falls back to tags when both probes reject', async () => {
    const renpyProbe = vi.fn().mockRejectedValue(new Error('renpy down'));
    const rpgmProbe = vi.fn().mockRejectedValue(new Error('rpgm down'));
    const unityProbe = vi.fn().mockRejectedValue(new Error('unity down'));
    await expect(
      resolveSaveEditorEngine(game({ storeTags: ["Ren'Py", 'RPGM'] }), {
        renpyProbe,
        rpgmProbe,
        unityProbe,
      }),
    ).resolves.toBe('renpy');
  });

  it("falls back to Ren'Py when Ren'Py+Unity tags and probes reject", async () => {
    const renpyProbe = vi.fn().mockRejectedValue(new Error('renpy down'));
    const rpgmProbe = vi.fn().mockRejectedValue(new Error('rpgm down'));
    const unityProbe = vi.fn().mockRejectedValue(new Error('unity down'));
    await expect(
      resolveSaveEditorEngine(game({ storeTags: ["Ren'Py", 'Unity'] }), {
        renpyProbe,
        rpgmProbe,
        unityProbe,
      }),
    ).resolves.toBe('renpy');
  });
});
