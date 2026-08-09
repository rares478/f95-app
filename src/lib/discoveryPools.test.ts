import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, query } = vi.hoisted(() => ({
  execute: vi.fn(),
  query: vi.fn(),
}));

vi.mock('./db', () => ({
  execute: (...args: unknown[]) => execute(...args),
  query: (...args: unknown[]) => query(...args),
}));

import { getPool, getPools, upsertPool } from './discoveryPools';

describe('discoveryPools', () => {
  beforeEach(() => {
    execute.mockReset();
    query.mockReset();
    execute.mockResolvedValue({ rowsAffected: 1 });
  });

  it('getPool returns null when missing', async () => {
    query.mockResolvedValueOnce([]);
    expect(await getPool('recent')).toBeNull();
  });

  it('getPool parses row', async () => {
    query.mockResolvedValueOnce([
      {
        key: 'likes',
        payload: JSON.stringify([{ threadId: '1', title: 'A' }]),
        fetched_at: 123,
      },
    ]);
    const row = await getPool('likes');
    expect(row).toEqual({
      key: 'likes',
      items: [expect.objectContaining({ threadId: '1' })],
      fetchedAt: 123,
    });
  });

  it('upsertPool writes JSON', async () => {
    await upsertPool('views', [{ threadId: '9' } as never], 99);
    expect(execute).toHaveBeenCalled();
    const [sql, params] = execute.mock.calls[0]!;
    expect(String(sql)).toMatch(/INSERT INTO discovery_pools/i);
    expect(params[0]).toBe('views');
    expect(params[2]).toBe(99);
  });

  it('getPools maps keys', async () => {
    query.mockResolvedValueOnce([
      { key: 'recent', payload: '[]', fetched_at: 1 },
      { key: 'likes', payload: '[]', fetched_at: 2 },
    ]);
    const map = await getPools(['recent', 'likes', 'views']);
    expect(map.has('recent')).toBe(true);
    expect(map.has('likes')).toBe(true);
    expect(map.has('views')).toBe(false);
  });
});
