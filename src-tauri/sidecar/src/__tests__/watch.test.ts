import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectHasMorePages,
  fetchThreadWatchState,
  fetchWatchedThreads,
  parseThreadWatchState,
  parseWatchedThreads,
} from '../domain/f95/watch';

const fix = (name: string) =>
  readFileSync(join(__dirname, '../__fixtures__', name), 'utf8');

const sidecarHtml = (name: string) =>
  readFileSync(join(__dirname, '../..', name), 'utf8');

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

describe('parseThreadWatchState', () => {
  it('parses not-watched state from thread-93340.html', () => {
    const html = sidecarHtml('thread-93340.html');
    const state = parseThreadWatchState(html, '93340');

    expect(state.watched).toBe(false);
    expect(state.watchUrl).toBe(
      'https://f95zone.to/threads/eternum-v0-9-5-public-caribdis.93340/watch',
    );
  });

  it('parses not-watched state from thread-dmd-597.html', () => {
    const html = sidecarHtml('thread-dmd-597.html');
    const state = parseThreadWatchState(html, '597');

    expect(state.watched).toBe(false);
    expect(state.watchUrl).toBe(
      'https://f95zone.to/threads/dating-my-daughter-ch-1-4-v1-01-mrdots-games.597/watch',
    );
  });

  it('detects watched state from Unwatch button text', () => {
    const html = `
      <a href="/threads/sample.123/watch"
         data-sk-watch="Watch"
         data-sk-unwatch="Unwatch">
        <span class="button-text">Unwatch</span>
      </a>`;
    const state = parseThreadWatchState(html, '123');

    expect(state.watched).toBe(true);
    expect(state.watchUrl).toBe('https://f95zone.to/threads/sample.123/watch');
  });

  it('detects watched state from /unwatch href', () => {
    const html = `
      <a href="/threads/sample.456/unwatch"
         data-sk-watch="Watch"
         data-sk-unwatch="Unwatch">
        <span class="button-text">Watch</span>
      </a>`;
    const state = parseThreadWatchState(html, '456');

    expect(state.watched).toBe(true);
    expect(state.watchUrl).toBe('https://f95zone.to/threads/sample.456/unwatch');
  });

  it('returns defaults when watch button is absent', () => {
    expect(parseThreadWatchState('<html></html>', '1')).toEqual({
      watched: false,
      watchUrl: null,
    });
  });
});

describe('fetchThreadWatchState', () => {
  it('fetches thread page by numeric id and parses watch state', async () => {
    const html = sidecarHtml('thread-93340.html');
    let requestedUrl = '';
    const http = {
      get: async (url: string) => {
        requestedUrl = url;
        return {
          status: 200,
          url: 'https://f95zone.to/threads/eternum-v0-9-5-public-caribdis.93340/',
          body: html,
          headers: {},
        };
      },
    };

    const state = await fetchThreadWatchState(http as never, '93340');
    expect(requestedUrl).toBe('https://f95zone.to/threads/93340/');
    expect(state.watched).toBe(false);
    expect(state.watchUrl).toBe(
      'https://f95zone.to/threads/eternum-v0-9-5-public-caribdis.93340/watch',
    );
  });
});
