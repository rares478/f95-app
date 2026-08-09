export const DISCOVERY_PAGE_ROWS = 15;
export const RECENT_PAGES = 2;
export const SLOW_POOL_PAGES = 5;
export const RECENT_TTL_MS = 60 * 60 * 1000;
export const SLOW_POOL_TTL_MS = 24 * 60 * 60 * 1000;
export const RAIL_DISPLAY_COUNT = 12;
export const SPOTLIGHT_COUNT = 5;
/** Curated pool; daily rails are a seeded subset of this list. */
export const TAG_RAIL_POOL = [
  'Fantasy',
  'Romance',
  'Sci-Fi',
  'Adventure',
  'RPG',
  'Sandbox',
  'School setting',
  'Male protagonist',
  'Female protagonist',
  'Monster girl',
  'NTR',
  'Big tits',
  'Oral sex',
  'Creampie',
  'Voyeurism',
  'Lesbian',
  'Furry',
  'MILF',
  'Corruption',
  'Mind control',
] as const;
export const TAG_RAIL_COUNT = 3;

export const VIEW_HISTORY_CAP = 24;
export const MIN_PLAYTIME_SECONDS = 300;
export const PERSONAL_TTL_MS = RECENT_TTL_MS;
export const PERSONAL_POOL_KEY = 'personal:home';
