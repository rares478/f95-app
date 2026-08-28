import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectHasMorePages,
  fetchWatchedThreads,
  parseWatchedThreads,
} from '../domain/f95/watch';

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

describe('detectHasMorePages', () => {
  it('returns false when pageNav is absent', () => {
    expect(detectHasMorePages('<html><body></body></html>', 1)).toBe(false);
  });

  it('returns true when next jump link is present', () => {
    const html = `
      <nav class="pageNav">
        <ul class="pageNav-main">
          <li class="pageNav-page pageNav-page--current"><a>1</a></li>
          <li class="pageNav-page"><a href="/watched/threads?page=2">2</a></li>
          <li class="pageNav-page pageNav-page--later"><a href="/watched/threads?page=2">Next</a></li>
        </ul>
      </nav>`;
    expect(detectHasMorePages(html, 1)).toBe(true);
  });

  it('returns false on last page when only page numbers are shown', () => {
    const html = `
      <nav class="pageNav">
        <ul class="pageNav-main">
          <li class="pageNav-page"><a href="/watched/threads?page=1">1</a></li>
          <li class="pageNav-page pageNav-page--current"><a>2</a></li>
        </ul>
      </nav>`;
    expect(detectHasMorePages(html, 2)).toBe(false);
  });
});

describe('fetchWatchedThreads', () => {
  it('fetches and parses watched threads from fixture', async () => {
    const html = fix('watched-threads-list.html');
    const http = {
      get: async (url: string) => ({
        status: 200,
        url,
        body: html,
        headers: {},
      }),
    };

    const result = await fetchWatchedThreads(http as never, 1);
    expect(result.page).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(result.threads.length).toBeGreaterThan(0);
    expect(result.threads.some((t) => t.threadId === '79740')).toBe(true);
  });

  it('requests paginated URL when page > 1', async () => {
    let requestedUrl = '';
    const http = {
      get: async (url: string) => {
        requestedUrl = url;
        return {
          status: 200,
          url,
          body: '<html></html>',
          headers: {},
        };
      },
    };

    await fetchWatchedThreads(http as never, 3);
    expect(requestedUrl).toBe('https://f95zone.to/watched/threads?page=3');
  });
});
