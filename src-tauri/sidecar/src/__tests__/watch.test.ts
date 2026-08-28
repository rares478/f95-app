import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWatchedThreads } from '../domain/f95/watch';

const fix = (name: string) =>
  readFileSync(join(__dirname, '../__fixtures__', name), 'utf8');

describe('parseWatchedThreads', () => {
  it('parses watched threads from fixture', () => {
    const html = fix('watched-threads-list.html');
    const threads = parseWatchedThreads(html);

    expect(threads.length).toBeGreaterThan(0);

    const freshWomen = threads.find((t) => t.threadId === '79740');
    expect(freshWomen).toBeDefined();
    expect(freshWomen!.title).toContain('FreshWomen');
    expect(freshWomen!.isUnreadOnF95).toBe(true);
    expect(freshWomen!.lastActivityAt).toBeTruthy();
    expect(freshWomen!.threadUrl).toBe(
      'https://f95zone.to/threads/freshwomen-s3-80-oppaiman.79740/unread',
    );
    expect(freshWomen!.forumName).toBe('Games');
  });

  it('returns empty array for empty html', () => {
    expect(parseWatchedThreads('')).toEqual([]);
    expect(parseWatchedThreads('   ')).toEqual([]);
  });
});
