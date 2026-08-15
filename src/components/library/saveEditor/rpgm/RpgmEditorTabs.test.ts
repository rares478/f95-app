import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RPGM_TAB,
  RPGM_EDITOR_TABS,
} from './RpgmEditorTabs';

describe('RpgmEditorTabs', () => {
  it('defaults to the party tab (not Raw)', () => {
    expect(DEFAULT_RPGM_TAB).toBe('party');
    expect(RPGM_EDITOR_TABS[0]).toBe('party');
    expect(RPGM_EDITOR_TABS).toContain('raw');
    expect(RPGM_EDITOR_TABS.indexOf('raw')).toBeGreaterThan(
      RPGM_EDITOR_TABS.indexOf('party'),
    );
  });
});
