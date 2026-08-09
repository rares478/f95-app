import type { LibraryGame } from '../types/library';
import { MIN_PLAYTIME_SECONDS } from './discoveryConfig';

export interface PersonalizationSeed {
  threadId: string;
  title: string;
  lastPlayedAt: string;
  totalPlaytimeSeconds: number;
}

function toSeed(g: LibraryGame): PersonalizationSeed | null {
  if (!g.lastPlayedAt || g.totalPlaytimeSeconds <= 0) return null;
  return {
    threadId: g.threadId,
    title: g.title,
    lastPlayedAt: g.lastPlayedAt,
    totalPlaytimeSeconds: g.totalPlaytimeSeconds,
  };
}

export function pickPersonalizationSeeds(
  games: LibraryGame[],
  limit = 3,
): PersonalizationSeed[] {
  const played = games.map(toSeed).filter((s): s is PersonalizationSeed => s != null);
  const preferred = played.filter((s) => s.totalPlaytimeSeconds >= MIN_PLAYTIME_SECONDS);
  const pool = preferred.length > 0 ? preferred : played;
  return [...pool]
    .sort((a, b) => b.lastPlayedAt.localeCompare(a.lastPlayedAt))
    .slice(0, limit);
}

export function personalizationFingerprint(seeds: PersonalizationSeed[]): string {
  return seeds.map((s) => `${s.threadId}@${s.lastPlayedAt}`).join('|');
}

export function truncateRailTitle(title: string, max = 40): string {
  const t = title.trim();
  if (t.length <= max) return t;
  if (max <= 1) return '…';
  return `${t.slice(0, max - 1)}…`;
}
