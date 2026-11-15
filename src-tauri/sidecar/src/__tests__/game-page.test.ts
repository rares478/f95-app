import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameClient } from '../domain/game/client';
import {
  buildGameHistoryUrl,
  isF95GamePageHtml,
  parseGameHistoryHtml,
  parseGamePage,
  synthesizeChangelogHtml,
} from '../domain/game/gamePage';

const fix = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const okHeaders: Record<string, string> = {};

describe('buildGameHistoryUrl', () => {
  it('appends game-history with trailing slash normalization', () => {
    expect(buildGameHistoryUrl('https://f95zone.to/threads/68105/')).toBe(
      'https://f95zone.to/threads/68105/game-history',
    );
    expect(buildGameHistoryUrl('https://f95zone.to/threads/68105')).toBe(
      'https://f95zone.to/threads/68105/game-history',
    );
    expect(
      buildGameHistoryUrl('https://f95zone.to/threads/slug.68105/'),
    ).toBe('https://f95zone.to/threads/slug.68105/game-history');
  });
});

describe('isF95GamePageHtml', () => {
  it('detects f95gp_game template and rejects classic thread_view', () => {
    expect(isF95GamePageHtml(fix('thread-game-page-desert-stalker.html'))).toBe(
      true,
    );
    expect(isF95GamePageHtml('<html data-template="thread_view"></html>')).toBe(
      false,
    );
  });

  it('rejects classic HTML without f95gp before cheerio fallback', () => {
    // Large classic-shaped page with no f95gp marker — must be false without
    // needing the cheerio path to succeed for correctness.
    const classic = `<!DOCTYPE html><html data-template="thread_view"><body>
      ${'<p>classic op content</p>'.repeat(200)}
      <article class="message"><div class="bbWrapper">Changelog</div></article>
    </body></html>`;
    expect(/f95gp/i.test(classic)).toBe(false);
    expect(isF95GamePageHtml(classic)).toBe(false);
  });

  it('still detects oddly quoted f95gp markers via cheerio fallback', () => {
    expect(
      isF95GamePageHtml(`<html data-template=f95gp_game class=f95gp-page></html>`),
    ).toBe(true);
    expect(
      isF95GamePageHtml(`<div class='other f95gp-page banner'></div>`),
    ).toBe(true);
  });
});

describe('GameClient.getDetail history isolation', () => {
  const threadUrl = 'https://f95zone.to/threads/68105/';
  const pageHtml = fix('thread-game-page-desert-stalker.html');

  function makeHttp(history: {
    throw?: unknown;
    status?: number;
    body?: string;
    headers?: Record<string, string>;
  }) {
    const gets: { url: string }[] = [];
    const http = {
      gets,
      get: async (url: string) => {
        gets.push({ url });
        if (url.includes('game-history')) {
          if (history.throw != null) throw history.throw;
          return {
            status: history.status ?? 200,
            url,
            body: history.body ?? '',
            headers: history.headers ?? okHeaders,
          };
        }
        return {
          status: 200,
          url: threadUrl,
          body: pageHtml,
          headers: okHeaders,
        };
      },
    };
    return http;
  }

  it('keeps layout gamePage and changelogHtml null when history GET throws', async () => {
    const http = makeHttp({ throw: new Error('network down') });
    const detail = await new GameClient(http as never).getDetail('68105');
    expect(detail.layout).toBe('gamePage');
    expect(detail.changelogHtml).toBeNull();
    expect(detail.threadId).toBe('68105');
    expect(http.gets.some((g) => g.url.includes('game-history'))).toBe(true);
  });

  it('keeps layout gamePage and changelogHtml null when history returns CF challenge', async () => {
    const http = makeHttp({
      status: 403,
      body: '<html><title>Just a moment...</title><div class="challenge-platform"></div></html>',
      headers: { 'cf-mitigated': 'challenge' },
    });
    const detail = await new GameClient(http as never).getDetail('68105');
    expect(detail.layout).toBe('gamePage');
    expect(detail.changelogHtml).toBeNull();
  });

  it('keeps layout gamePage and changelogHtml null when history returns 4xx', async () => {
    const http = makeHttp({
      status: 404,
      body: '<html><body>Not Found</body></html>',
    });
    const detail = await new GameClient(http as never).getDetail('68105');
    expect(detail.layout).toBe('gamePage');
    expect(detail.changelogHtml).toBeNull();
  });
});

describe('parseGamePage', () => {
  it('parses Desert Stalker game page core fields', () => {
    const detail = parseGamePage(
      fix('thread-game-page-desert-stalker.html'),
      'https://f95zone.to/threads/68105/',
    );
    expect(detail.layout).toBe('gamePage');
    expect(detail.threadId).toBe('68105');
    expect(detail.title).toMatch(/Desert Stalker/i);
    expect(detail.version).toMatch(/v0\.22\.0/i);
    expect(detail.developer).toMatch(/Zetan/i);
    expect(detail.bannerUrl).toMatch(/68105\.jpg/);
    expect(detail.rating).toBe(4.8);
    expect(detail.descriptionHtml).toMatch(/antiquity scavenger/i);
    expect(detail.fields.Developer).toMatch(/Zetan/i);
    expect(detail.fields.Version).toMatch(/v0\.22\.0/i);
    expect(detail.tags.some((t) => t.slug === '3dcg')).toBe(true);
    expect(detail.gamePage?.whatsNew?.items.length).toBeGreaterThan(0);
    expect(detail.gamePage?.whatsNew?.historyHref).toMatch(/game-history/);
    expect(detail.gamePage?.folds.some((f) => /Installation/i.test(f.title))).toBe(
      true,
    );
    expect(detail.gamePage?.tagGroups.length).toBeGreaterThanOrEqual(2);
    expect(detail.gamePage?.stats?.likesLabel).toBeTruthy();
    expect(detail.changelogHtml).toBeNull(); // filled by getDetail fetch later
  });

  it('parses Desert Stalker game-history rows', () => {
    const rows = parseGameHistoryHtml(
      fix('thread-game-history-desert-stalker.html'),
    );
    expect(rows.length).toBeGreaterThan(10);
    expect(rows[0]?.version).toMatch(/v0\.22\.0/i);
    expect(rows[0]?.lines.length).toBeGreaterThan(0);
    expect(rows.some((r) => /v0\.21\.4/i.test(r.version))).toBe(true);
  });

  it('synthesizes changelogHtml with bold version headers', () => {
    const html = synthesizeChangelogHtml([
      { version: 'v0.22.0 Beta', date: '2026-11-14', lines: ['A', 'B'] },
      { version: 'v0.21.4', date: null, lines: ['C'] },
    ]);
    expect(html).toContain('<b>v0.22.0 Beta</b>');
    expect(html).toContain('<b>v0.21.4</b>');
    expect(html).toContain('<li>A</li>');
  });
});
