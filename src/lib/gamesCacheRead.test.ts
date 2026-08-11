import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./db', () => ({ query: (...a: unknown[]) => query(...a) }));

import { getCachedTagIds } from './gamesCacheRead';

describe('getCachedTagIds', () => {
  beforeEach(() => query.mockReset());

  it('parses numeric tag id arrays', async () => {
    query.mockResolvedValueOnce([{ tags_json: '[1,2,3]' }]);
    await expect(getCachedTagIds('9')).resolves.toEqual([1, 2, 3]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM games_cache'),
      ['9'],
    );
  });

  it('returns null when missing/invalid', async () => {
    query.mockResolvedValueOnce([]);
    await expect(getCachedTagIds('9')).resolves.toBeNull();

    query.mockResolvedValueOnce([{ tags_json: null }]);
    await expect(getCachedTagIds('9')).resolves.toBeNull();

    query.mockResolvedValueOnce([{ tags_json: '{not-json' }]);
    await expect(getCachedTagIds('9')).resolves.toBeNull();

    query.mockResolvedValueOnce([{ tags_json: '[]' }]);
    await expect(getCachedTagIds('9')).resolves.toBeNull();

    query.mockResolvedValueOnce([{ tags_json: '["a",1]' }]);
    await expect(getCachedTagIds('9')).resolves.toEqual([1]);
  });
});
