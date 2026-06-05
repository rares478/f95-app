import { execute, query } from './db';
import type { AppNotification, NotificationSource } from '../types/alerts';

interface DbRow {
  id: string;
  source: string;
  thread_id: string | null;
  title: string;
  body: string | null;
  url: string | null;
  thumbnail_url: string | null;
  created_at: string;
  read_at: string | null;
}

function rowToNotification(r: DbRow): AppNotification {
  return {
    id: r.id,
    source: r.source as NotificationSource,
    threadId: r.thread_id,
    title: r.title,
    body: r.body,
    url: r.url,
    thumbnailUrl: r.thumbnail_url,
    createdAt: r.created_at,
    readAt: r.read_at,
  };
}

export interface UpsertNotificationInput {
  id: string;
  source: NotificationSource;
  threadId?: string | null;
  title: string;
  body?: string | null;
  url?: string | null;
  thumbnailUrl?: string | null;
}

export async function upsert(input: UpsertNotificationInput): Promise<void> {
  await execute(
    `INSERT INTO notifications (id, source, thread_id, title, body, url, thumbnail_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       body = excluded.body,
       url = excluded.url,
       thumbnail_url = excluded.thumbnail_url`,
    [
      input.id,
      input.source,
      input.threadId ?? null,
      input.title,
      input.body ?? null,
      input.url ?? null,
      input.thumbnailUrl ?? null,
    ],
  );
}

export async function list(options: {
  source?: NotificationSource;
  unreadOnly?: boolean;
  limit?: number;
} = {}): Promise<AppNotification[]> {
  const clauses: string[] = [];
  const args: unknown[] = [];

  if (options.source) {
    clauses.push('source = ?');
    args.push(options.source);
  }
  if (options.unreadOnly) {
    clauses.push('read_at IS NULL');
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = options.limit ?? 200;
  args.push(limit);

  const rows = await query<DbRow>(
    `SELECT * FROM notifications ${where}
     ORDER BY datetime(created_at) DESC
     LIMIT ?`,
    args,
  );
  return rows.map(rowToNotification);
}

export async function unreadCount(): Promise<number> {
  const rows = await query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL`,
  );
  return rows[0]?.count ?? 0;
}

export async function markRead(id: string): Promise<void> {
  await execute(
    `UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL`,
    [id],
  );
}

export async function markAllRead(source?: NotificationSource): Promise<void> {
  if (source) {
    await execute(
      `UPDATE notifications SET read_at = datetime('now') WHERE read_at IS NULL AND source = ?`,
      [source],
    );
    return;
  }
  await execute(`UPDATE notifications SET read_at = datetime('now') WHERE read_at IS NULL`);
}

export async function isRssGuidSeen(guid: string): Promise<boolean> {
  const rows = await query<{ guid: string }>(
    `SELECT guid FROM rss_seen_guids WHERE guid = ? LIMIT 1`,
    [guid],
  );
  return rows.length > 0;
}

export async function markRssGuidSeen(guid: string): Promise<void> {
  await execute(
    `INSERT OR IGNORE INTO rss_seen_guids (guid, seen_at) VALUES (?, datetime('now'))`,
    [guid],
  );
}

export async function seedRssGuids(guids: string[]): Promise<void> {
  for (const guid of guids) {
    await markRssGuidSeen(guid);
  }
}
