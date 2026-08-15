import { describe, expect, it, vi } from 'vitest';
import { shouldShowSaveEditor } from './renpySaveGate';
import type { RenpyProbeResult } from '../types/renpySave';
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

function probeResult(over: Partial<RenpyProbeResult> = {}): RenpyProbeResult {
  return {
    isRenpyLayout: false,
    savesDir: null,
    ...over,
  };
}

describe('shouldShowSaveEditor', () => {
  it('is true when store tags indicate Ren\'Py', async () => {
    const probe = vi.fn();
    const result = await shouldShowSaveEditor(
      game({ storeTags: ["Ren'Py"] }),
      probe,
    );
    expect(result).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });

  it('is true when tags are not Ren\'Py but probe finds layout', async () => {
    const probe = vi.fn().mockResolvedValue(probeResult({ isRenpyLayout: true }));
    const result = await shouldShowSaveEditor(
      game({ storeTags: ['Unity'], installPath: 'D:/Games/HiddenRenpy' }),
      probe,
    );
    expect(result).toBe(true);
    expect(probe).toHaveBeenCalledWith('D:/Games/HiddenRenpy');
  });

  it('is false when not installed', async () => {
    const probe = vi.fn().mockResolvedValue(probeResult({ isRenpyLayout: true }));
    const result = await shouldShowSaveEditor(
      game({
        installStatus: 'not_installed',
        installPath: 'D:/Games/Example',
        storeTags: ["Ren'Py"],
      }),
      probe,
    );
    expect(result).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it('is false when installed without installPath', async () => {
    const probe = vi.fn();
    const result = await shouldShowSaveEditor(
      game({ installPath: null, storeTags: ["Ren'Py"] }),
      probe,
    );
    expect(result).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it('is false when tags miss and probe is not Ren\'Py layout', async () => {
    const probe = vi.fn().mockResolvedValue(probeResult({ isRenpyLayout: false }));
    const result = await shouldShowSaveEditor(
      game({ storeTags: ['Unity'] }),
      probe,
    );
    expect(result).toBe(false);
    expect(probe).toHaveBeenCalledOnce();
  });
});
