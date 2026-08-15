import { describe, expect, it, vi } from 'vitest';
import { resolveSaveEditorEngine, shouldShowSaveEditor } from './saveEditorGate';
import type { RenpyProbeResult } from '../types/renpySave';
import type { RpgmProbeResult } from '../types/rpgmSave';
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

describe('shouldShowSaveEditor / resolveSaveEditorEngine', () => {
  it("is renpy when store tags indicate Ren'Py only (no probe)", async () => {
    const renpyProbe = vi.fn();
    const rpgmProbe = vi.fn();
    const engine = await resolveSaveEditorEngine(game({ storeTags: ["Ren'Py"] }), {
      renpyProbe,
      rpgmProbe,
    });
    expect(engine).toBe('renpy');
    expect(await shouldShowSaveEditor(game({ storeTags: ["Ren'Py"] }), { renpyProbe, rpgmProbe })).toBe(
      true,
    );
    expect(renpyProbe).not.toHaveBeenCalled();
    expect(rpgmProbe).not.toHaveBeenCalled();
  });

  it('is rpgm when store tags indicate RPGM only (no probe)', async () => {
    const renpyProbe = vi.fn();
    const rpgmProbe = vi.fn();
    const engine = await resolveSaveEditorEngine(game({ storeTags: ['RPGM'] }), {
      renpyProbe,
      rpgmProbe,
    });
    expect(engine).toBe('rpgm');
    expect(await shouldShowSaveEditor(game({ storeTags: ['rpgm'] }), { renpyProbe, rpgmProbe })).toBe(
      true,
    );
    expect(renpyProbe).not.toHaveBeenCalled();
    expect(rpgmProbe).not.toHaveBeenCalled();
  });

  it("is true when tags miss but Ren'Py probe finds layout", async () => {
    const renpyProbe = vi.fn().mockResolvedValue(
      renpyProbeResult({ isRenpyLayout: true, savesDir: 'D:/Games/HiddenRenpy/game/saves' }),
    );
    const rpgmProbe = vi.fn().mockResolvedValue(rpgmProbeResult());
    const result = await shouldShowSaveEditor(
      game({ storeTags: ['Unity'], installPath: 'D:/Games/HiddenRenpy' }),
      { renpyProbe, rpgmProbe },
    );
    expect(result).toBe(true);
    expect(await resolveSaveEditorEngine(
      game({ storeTags: ['Unity'], installPath: 'D:/Games/HiddenRenpy' }),
      { renpyProbe, rpgmProbe },
    )).toBe('renpy');
    expect(renpyProbe).toHaveBeenCalledWith('D:/Games/HiddenRenpy');
    expect(rpgmProbe).toHaveBeenCalledWith('D:/Games/HiddenRenpy');
  });

  it('is rpgm when tags miss but RPGM probe finds savesDir', async () => {
    const renpyProbe = vi.fn().mockResolvedValue(renpyProbeResult());
    const rpgmProbe = vi.fn().mockResolvedValue(
      rpgmProbeResult({ isRpgmLayout: true, savesDir: 'D:/Games/Rpg/www/save', variant: 'mz' }),
    );
    expect(
      await resolveSaveEditorEngine(game({ storeTags: ['Unity'] }), { renpyProbe, rpgmProbe }),
    ).toBe('rpgm');
  });

  it('is false when not installed', async () => {
    const renpyProbe = vi.fn().mockResolvedValue(renpyProbeResult({ isRenpyLayout: true }));
    const rpgmProbe = vi.fn();
    const result = await shouldShowSaveEditor(
      game({
        installStatus: 'not_installed',
        installPath: 'D:/Games/Example',
        storeTags: ["Ren'Py"],
      }),
      { renpyProbe, rpgmProbe },
    );
    expect(result).toBe(false);
    expect(renpyProbe).not.toHaveBeenCalled();
    expect(rpgmProbe).not.toHaveBeenCalled();
  });

  it('is false when installed without installPath', async () => {
    const renpyProbe = vi.fn();
    const rpgmProbe = vi.fn();
    const result = await shouldShowSaveEditor(
      game({ installPath: null, storeTags: ['RPGM'] }),
      { renpyProbe, rpgmProbe },
    );
    expect(result).toBe(false);
    expect(renpyProbe).not.toHaveBeenCalled();
    expect(rpgmProbe).not.toHaveBeenCalled();
  });

  it('is false when tags miss and neither probe finds a layout', async () => {
    const renpyProbe = vi.fn().mockResolvedValue(renpyProbeResult());
    const rpgmProbe = vi.fn().mockResolvedValue(rpgmProbeResult());
    const result = await shouldShowSaveEditor(game({ storeTags: ['Unity'] }), {
      renpyProbe,
      rpgmProbe,
    });
    expect(result).toBe(false);
    expect(renpyProbe).toHaveBeenCalledOnce();
    expect(rpgmProbe).toHaveBeenCalledOnce();
  });

  it("prefers Ren'Py when both tags and both probes have savesDir (tie → renpy)", async () => {
    const renpyProbe = vi.fn().mockResolvedValue(
      renpyProbeResult({ isRenpyLayout: true, savesDir: 'D:/a/saves' }),
    );
    const rpgmProbe = vi.fn().mockResolvedValue(
      rpgmProbeResult({ isRpgmLayout: true, savesDir: 'D:/a/save', variant: 'mv' }),
    );
    expect(
      await resolveSaveEditorEngine(game({ storeTags: ["Ren'Py", 'RPGM'] }), {
        renpyProbe,
        rpgmProbe,
      }),
    ).toBe('renpy');
    expect(renpyProbe).toHaveBeenCalledOnce();
    expect(rpgmProbe).toHaveBeenCalledOnce();
  });
});
