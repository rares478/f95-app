import { execute, query } from './db';
import type { AchievementDefinition, AchievementStats, AchievementUnlock } from '../types/achievements';

interface DefRow {
  id: string;
  thread_id: string | null;
  title: string;
  description: string | null;
  icon_key: string | null;
  points: number;
  hidden: number;
  sort_order: number;
}

interface UnlockRow {
  thread_id: string;
  achievement_id: string;
  unlocked_at: string;
  progress_json: string | null;
}

function mapDef(r: DefRow): AchievementDefinition {
  return {
    id: r.id,
    threadId: r.thread_id,
    title: r.title,
    description: r.description,
    iconKey: r.icon_key,
    points: r.points,
    hidden: r.hidden !== 0,
    sortOrder: r.sort_order,
  };
}

function mapUnlock(r: UnlockRow): AchievementUnlock {
  return {
    threadId: r.thread_id,
    achievementId: r.achievement_id,
    unlockedAt: r.unlocked_at,
    progressJson: r.progress_json,
  };
}

export async function listForGame(threadId: string): Promise<AchievementDefinition[]> {
  const rows = await query<DefRow>(
    `SELECT * FROM achievement_definitions
     WHERE thread_id = ? OR thread_id IS NULL
     ORDER BY sort_order ASC, title ASC`,
    [threadId],
  );
  return rows.map(mapDef).filter((d) => !d.hidden || import.meta.env.DEV);
}

export async function listGlobal(): Promise<AchievementDefinition[]> {
  const rows = await query<DefRow>(
    `SELECT * FROM achievement_definitions
     WHERE thread_id IS NULL
     ORDER BY sort_order ASC, title ASC`,
  );
  return rows.map(mapDef).filter((d) => !d.hidden || import.meta.env.DEV);
}

export async function listUnlocksForGame(threadId: string): Promise<AchievementUnlock[]> {
  const rows = await query<UnlockRow>(
    `SELECT * FROM user_achievement_unlocks WHERE thread_id = ? OR thread_id = ''`,
    [threadId],
  );
  return rows.map(mapUnlock);
}

export async function getStats(threadId: string): Promise<AchievementStats> {
  const defs = await listForGame(threadId);
  const unlocks = await listUnlocksForGame(threadId);
  const unlockedIds = new Set(unlocks.map((u) => u.achievementId));
  const unlocked = defs.filter((d) => unlockedIds.has(d.id));
  return {
    total: defs.length,
    unlocked: unlocked.length,
    points: unlocked.reduce((sum, d) => sum + d.points, 0),
  };
}

/** Local unlock for dev/testing — no real game integration yet. */
export async function unlock(
  threadId: string,
  achievementId: string,
  progressJson?: string | null,
): Promise<void> {
  await execute(
    `INSERT INTO user_achievement_unlocks (thread_id, achievement_id, progress_json)
     VALUES (?, ?, ?)
     ON CONFLICT(thread_id, achievement_id) DO UPDATE SET
       unlocked_at = datetime('now'),
       progress_json = excluded.progress_json`,
    [threadId, achievementId, progressJson ?? null],
  );
}

export async function seedDevAchievements(): Promise<void> {
  if (!import.meta.env.DEV) return;
  await execute(
    `INSERT OR IGNORE INTO achievement_definitions
     (id, thread_id, title, description, icon_key, points, hidden, sort_order)
     VALUES ('dev:sample', NULL, 'Dev Sample', 'Hidden dev achievement shell', 'trophy', 10, 1, 0)`,
  );
}
