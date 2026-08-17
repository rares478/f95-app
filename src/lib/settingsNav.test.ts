import { describe, expect, it } from 'vitest';
import { parseSettingsSection } from './settingsNav';

describe('parseSettingsSection', () => {
  it('defaults to general when missing', () => {
    expect(parseSettingsSection(null)).toBe('general');
    expect(parseSettingsSection(undefined)).toBe('general');
    expect(parseSettingsSection('')).toBe('general');
  });

  it('accepts current section ids', () => {
    expect(parseSettingsSection('hosts')).toBe('hosts');
    expect(parseSettingsSection('data')).toBe('data');
  });

  it('maps legacy section ids', () => {
    expect(parseSettingsSection('storage')).toBe('library');
    expect(parseSettingsSection('system')).toBe('app');
  });

  it('falls back for unknown ids', () => {
    expect(parseSettingsSection('nope')).toBe('general');
  });
});
