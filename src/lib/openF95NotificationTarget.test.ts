import { describe, expect, it } from 'vitest';
import { storePathForContentTarget } from './openF95NotificationTarget';

describe('storePathForContentTarget', () => {
  it('builds store path with cat and optional post', () => {
    expect(
      storePathForContentTarget({ kind: 'thread', threadId: '12', postId: null }),
    ).toBe('/store/game/12?cat=games');

    expect(
      storePathForContentTarget(
        { kind: 'thread', threadId: '12', postId: '34' },
        'games',
      ),
    ).toBe('/store/game/12?cat=games&post=34');
  });

  it('uses custom category', () => {
    expect(
      storePathForContentTarget(
        { kind: 'thread', threadId: '99', postId: null },
        'comics',
      ),
    ).toBe('/store/game/99?cat=comics');
  });
});
