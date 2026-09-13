import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('./db', () => ({
  execute: vi.fn(),
  query: (...args: unknown[]) => query(...args),
}));

import { countForThread } from './sessions';

describe('sessions.countForThread', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('returns COUNT(*) for the thread', async () => {
    query.mockResolvedValueOnce([{ n: 42 }]);
    await expect(countForThread('t1')).resolves.toBe(42);
    expect(query).toHaveBeenCalledWith(
      `SELECT COUNT(*) AS n FROM play_sessions WHERE thread_id = ?`,
      ['t1'],
    );
  });

  it('returns 0 when no rows', async () => {
    query.mockResolvedValueOnce([]);
    await expect(countForThread('t1')).resolves.toBe(0);
  });
});
