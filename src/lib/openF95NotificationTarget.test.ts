import { describe, expect, it } from 'vitest';
import { storePathForContentTarget } from './openF95NotificationTarget';

describe('storePathForContentTarget', () => {
  it('builds store path with cat and optional post', () => {
    expect(
      storePathForContentTarget({ kind: 'thread', threadId: '12', postId: null, page: null }),
    ).toBe('/store/game/12?cat=games');

    expect(
      storePathForContentTarget(
        { kind: 'thread', threadId: '12', postId: '34', page: null },
        'games',
      ),
    ).toBe('/store/game/12?cat=games&post=34');
  });

  it('adds page with or without post', () => {
    expect(
      storePathForContentTarget({
        kind: 'thread',
        threadId: '12',
        postId: null,
        page: 5,
      }),
    ).toBe('/store/game/12?cat=games&page=5');

    expect(
      storePathForContentTarget({
        kind: 'thread',
        threadId: '12',
        postId: '99',
        page: 5,
      }),
    ).toBe('/store/game/12?cat=games&post=99&page=5');
  });

  it('uses custom category', () => {
    expect(
      storePathForContentTarget(
        { kind: 'thread', threadId: '99', postId: null, page: null },
        'comics',
      ),
    ).toBe('/store/game/99?cat=comics');
  });
});
