import { parseSamCategory } from '../constants/samCategories';
import type { SamCategory, SamGameCard } from '../types/sam';
import { RAIL_DISPLAY_COUNT, VIEW_HISTORY_CAP } from './discoveryConfig';
import { execute, query } from './db';

export interface StoreViewRecord {
  threadId: string;
  category: SamCategory;
  title: string;
  thumbnailUrl: string | null;
  threadUrl: string;
  viewedAt: string;
}

interface DbRow {
  thread_id: string;
  category: string;
  title: string;
  thumbnail_url: string | null;
  thread_url: string;
  viewed_at: string;
}

function rowToRecord(r: DbRow): StoreViewRecord {
  return {
    threadId: r.thread_id,
    category: parseSamCategory(r.category),
    title: r.title,
    thumbnailUrl: r.thumbnail_url,
    threadUrl: r.thread_url,
    viewedAt: r.viewed_at,
  };
}

export function viewRecordToSamCard(row: StoreViewRecord): SamGameCard {
  return {
    threadId: row.threadId,
    title: row.title,
    version: null,
    thumbnailUrl: row.thumbnailUrl,
    screens: [],
    threadUrl: row.threadUrl,
    prefixIds: [],
    tagIds: [],
    rating: null,
    views: null,
    likes: null,
    updatedAt: null,
    updatedTs: null,
    creator: null,
    watched: false,
    ignored: false,
    isNew: false,
  };
}

export async function recordStoreView(
  input: Omit<StoreViewRecord, 'viewedAt'> & { viewedAt?: string },
): Promise<void> {
  const viewedAt = input.viewedAt ?? new Date().toISOString();
  await execute(
    `INSERT INTO store_view_history
       (thread_id, category, title, thumbnail_url, thread_url, viewed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET
       category = excluded.category,
       title = excluded.title,
       thumbnail_url = excluded.thumbnail_url,
       thread_url = excluded.thread_url,
       viewed_at = excluded.viewed_at`,
    [
      input.threadId,
      input.category,
      input.title,
      input.thumbnailUrl,
      input.threadUrl,
      viewedAt,
    ],
  );

  const overflow = await query<{ thread_id: string }>(
    `SELECT thread_id FROM store_view_history
     ORDER BY viewed_at DESC
     LIMIT -1 OFFSET ?`,
    [VIEW_HISTORY_CAP],
  );
  if (overflow.length === 0) return;
  const ids = overflow.map((r) => r.thread_id);
  const placeholders = ids.map(() => '?').join(',');
  await execute(
    `DELETE FROM store_view_history WHERE thread_id IN (${placeholders})`,
    ids,
  );
}

export async function listRecentStoreViews(
  limit = RAIL_DISPLAY_COUNT,
): Promise<StoreViewRecord[]> {
  const rows = await query<DbRow>(
    `SELECT thread_id, category, title, thumbnail_url, thread_url, viewed_at
     FROM store_view_history
     ORDER BY viewed_at DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map(rowToRecord);
}
