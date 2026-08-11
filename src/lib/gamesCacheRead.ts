import { query } from './db';

export async function getCachedTagIds(threadId: string): Promise<number[] | null> {
  const rows = await query<{ tags_json: string | null }>(
    `SELECT tags_json FROM games_cache WHERE thread_id = ? LIMIT 1`,
    [threadId],
  );
  const raw = rows[0]?.tags_json;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}
