export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'store'
  | 'library'
  | 'downloads'
  | 'hosts'
  | 'app'
  | 'data'
  | 'experimental'
  | 'account';

export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = [
  'general',
  'appearance',
  'store',
  'library',
  'downloads',
  'hosts',
  'app',
  'data',
  'experimental',
  'account',
] as const;

export interface SettingsNavGroup {
  labelKey: string;
  items: readonly SettingsSectionId[];
}

export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  {
    labelKey: 'settings.navGroup.personal',
    items: ['general', 'appearance'],
  },
  {
    labelKey: 'settings.navGroup.browsing',
    items: ['store'],
  },
  {
    labelKey: 'settings.navGroup.library',
    items: ['library', 'downloads', 'hosts'],
  },
  {
    labelKey: 'settings.navGroup.application',
    items: ['app', 'data'],
  },
  {
    labelKey: 'settings.navGroup.advanced',
    items: ['experimental', 'account'],
  },
] as const;

const LEGACY_SECTION_MAP: Record<string, SettingsSectionId> = {
  storage: 'library',
  system: 'app',
};

export function parseSettingsSection(raw: string | null | undefined): SettingsSectionId {
  if (!raw) return 'general';
  const mapped = LEGACY_SECTION_MAP[raw] ?? raw;
  return SETTINGS_SECTION_IDS.includes(mapped as SettingsSectionId)
    ? (mapped as SettingsSectionId)
    : 'general';
}

export function settingsSectionLabelKey(id: SettingsSectionId): string {
  return `settings.nav.${id}`;
}
