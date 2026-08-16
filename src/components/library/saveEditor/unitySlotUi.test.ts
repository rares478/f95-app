import { describe, expect, it } from 'vitest';
import type { RenpySaveSlot } from '../../../types/renpySave';
import type { UnitySaveSlot } from '../../../types/unitySave';
import {
  isUnitySaveSlot,
  slotKindLocaleKey,
  unitySourceLocaleKey,
} from './unitySlotUi';

const renpySlot: RenpySaveSlot = {
  key: '1-1',
  kind: 'slot',
  mtimeMs: 1,
  sizeBytes: 10,
  hasScreenshot: false,
};

const unitySlot: UnitySaveSlot = {
  key: 'localLow:SaveFile.es3',
  displayName: 'SaveFile.es3',
  kind: 'es3',
  source: 'localLow',
  encrypted: true,
  mtimeMs: 1,
  sizeBytes: 10,
};

describe('isUnitySaveSlot', () => {
  it('detects Unity slots', () => {
    expect(isUnitySaveSlot(unitySlot)).toBe(true);
  });

  it('rejects RenPy / RPGM slots', () => {
    expect(isUnitySaveSlot(renpySlot)).toBe(false);
  });
});

describe('unitySourceLocaleKey', () => {
  it('maps known sources', () => {
    expect(unitySourceLocaleKey('localLow')).toBe('saveEditor.unity.source.localLow');
    expect(unitySourceLocaleKey('install')).toBe('saveEditor.unity.source.install');
  });

  it('falls back for unknown sources', () => {
    expect(unitySourceLocaleKey('other')).toBe('saveEditor.kind.other');
  });
});

describe('slotKindLocaleKey', () => {
  it('includes Unity kinds', () => {
    expect(slotKindLocaleKey('es3')).toBe('saveEditor.kind.es3');
    expect(slotKindLocaleKey('json')).toBe('saveEditor.kind.json');
  });

  it('keeps RenPy kinds', () => {
    expect(slotKindLocaleKey('auto')).toBe('saveEditor.kind.auto');
  });
});
