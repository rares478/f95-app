export type HeaderKind =
  | 'version'
  | 'chapter'
  | 'season'
  | 'date'
  | 'seasonSoft'
  | 'releaseSoft';

export type GameChangelogEntry = {
  title: string;
  bodyHtml: string;
};

export type GameChangelogParseOk = {
  ok: true;
  preambleHtml: string;
  entries: GameChangelogEntry[];
};

export type GameChangelogParseResult = GameChangelogParseOk | { ok: false };
