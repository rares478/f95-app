import { describe, expect, it } from 'vitest';
import type { F95Alert } from '../types/alerts';
import { unreadAlertThreadIds } from './watchAlerts';

function alert(overrides: Partial<F95Alert> = {}): F95Alert {
  return {
    alertId: '1',
    text: 'Someone replied',
    url: null,
    avatarUrl: null,
    username: 'user',
    userId: '42',
    date: '2026-08-28T12:00:00Z',
    isUnread: true,
    ...overrides,
  };
}

describe('unreadAlertThreadIds', () => {
  it('includes unread thread reply alerts', () => {
    const ids = unreadAlertThreadIds([
      alert({
        alertId: 'thread-reply',
        url: 'https://f95zone.to/threads/freshwomen.79740/unread#post-1234567',
      }),
    ]);

    expect(ids).toEqual(new Set(['79740']));
  });

  it('includes unread thread page alerts without post anchor', () => {
    const ids = unreadAlertThreadIds([
      alert({
        url: 'https://f95zone.to/threads/some-game.12345/page-3',
      }),
    ]);

    expect(ids).toEqual(new Set(['12345']));
  });

  it('ignores conversation alerts', () => {
    const ids = unreadAlertThreadIds([
      alert({
        url: 'https://f95zone.to/conversations/hello-world.12345/unread',
      }),
    ]);

    expect(ids).toEqual(new Set());
  });

  it('ignores post-only alerts in v1', () => {
    const ids = unreadAlertThreadIds([
      alert({
        url: 'https://f95zone.to/posts/99999/',
      }),
    ]);

    expect(ids).toEqual(new Set());
  });

  it('ignores external and missing URLs', () => {
    const ids = unreadAlertThreadIds([
      alert({ url: 'https://example.com/thread/1' }),
      alert({ url: 'https://f95zone.to/account/alerts' }),
      alert({ url: null }),
    ]);

    expect(ids).toEqual(new Set());
  });

  it('ignores read alerts', () => {
    const ids = unreadAlertThreadIds([
      alert({
        isUnread: false,
        url: 'https://f95zone.to/threads/freshwomen.79740/',
      }),
    ]);

    expect(ids).toEqual(new Set());
  });

  it('deduplicates multiple unread alerts for the same thread', () => {
    const ids = unreadAlertThreadIds([
      alert({
        alertId: 'a',
        url: 'https://f95zone.to/threads/freshwomen.79740/#post-1',
      }),
      alert({
        alertId: 'b',
        url: 'https://f95zone.to/threads/freshwomen.79740/page-2',
      }),
    ]);

    expect(ids).toEqual(new Set(['79740']));
  });

  it('collects distinct thread ids from mixed alert types', () => {
    const ids = unreadAlertThreadIds([
      alert({
        url: 'https://f95zone.to/threads/game-a.111/',
      }),
      alert({
        url: 'https://f95zone.to/threads/game-b.222/#post-55',
      }),
      alert({
        url: 'https://f95zone.to/conversations/ignored.333/',
      }),
      alert({
        url: 'https://f95zone.to/posts/444/',
      }),
      alert({
        isUnread: false,
        url: 'https://f95zone.to/threads/read-only.555/',
      }),
    ]);

    expect(ids).toEqual(new Set(['111', '222']));
  });
});
