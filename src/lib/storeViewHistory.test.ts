import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, query } = vi.hoisted(() => ({
  execute: vi.fn(),
  query: vi.fn(),
}));

vi.mock('./db', () => ({
  execute: (...args: unknown[]) => execute(...args),
  query: (...args: unknown[]) => query(...args),
}));

import { recordStoreView, listRecentStoreViews, viewRecordToSamCard } from './storeViewHistory';
import { VIEW_HISTORY_CAP } from './discoveryConfig';

describe('storeViewHistory', () => {
  beforeEach(() => {
    execute.mockReset();
    query.mockReset();
    execute.mockResolvedValue({ rowsAffected: 1 });
  });

  it('recordStoreView upserts then trims beyond cap', async () => {
    // Overflow SELECT uses OFFSET VIEW_HISTORY_CAP; mock returns those rows only.
    query.mockResolvedValueOnce([
      { thread_id: 'old-0' },
      { thread_id: 'old-1' },
    ]);

    await recordStoreView({
      threadId: '42',
      category: 'games',
      title: 'Demo',
      thumbnailUrl: 'https://img/x',
      threadUrl: 'https://f95/t',
      viewedAt: '2026-08-09T12:00:00.000Z',
    });

    const upsert = execute.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO store_view_history'),
    );
    expect(upsert).toBeTruthy();
    expect(upsert![1]).toEqual([
      '42',
      'games',
      'Demo',
      'https://img/x',
      'https://f95/t',
      '2026-08-09T12:00:00.000Z',
    ]);

    const del = execute.mock.calls.find((c) =>
      String(c[0]).includes('DELETE FROM store_view_history'),
    );
    expect(del).toBeTruthy();
    expect(del![1]).toEqual(['old-0', 'old-1']);
    expect(query.mock.calls[0]![1]).toEqual([VIEW_HISTORY_CAP]);
  });

  it('listRecentStoreViews orders by viewed_at desc', async () => {
    query.mockResolvedValueOnce([
      {
        thread_id: '2',
        category: 'games',
        title: 'B',
        thumbnail_url: null,
        thread_url: 'https://b',
        viewed_at: '2026-08-09T13:00:00.000Z',
      },
      {
        thread_id: '1',
        category: 'games',
        title: 'A',
        thumbnail_url: null,
        thread_url: 'https://a',
        viewed_at: '2026-08-09T12:00:00.000Z',
      },
    ]);

    const rows = await listRecentStoreViews(12);
    expect(rows.map((r) => r.threadId)).toEqual(['2', '1']);
    expect(String(query.mock.calls[0]![0])).toContain('ORDER BY viewed_at DESC');
  });

  it('viewRecordToSamCard maps snapshot fields', () => {
    const card = viewRecordToSamCard({
      threadId: '9',
      category: 'games',
      title: 'T',
      thumbnailUrl: null,
      threadUrl: 'https://t',
      viewedAt: '2026-08-09T12:00:00.000Z',
    });
    expect(card.threadId).toBe('9');
    expect(card.title).toBe('T');
    expect(card.threadUrl).toBe('https://t');
    expect(card.screens).toEqual([]);
    expect(card.tagIds).toEqual([]);
  });
});
