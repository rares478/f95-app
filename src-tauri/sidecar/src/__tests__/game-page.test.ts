import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameClient } from '../domain/game/client';
import {
  buildGameDownloadsUrl,
  buildGameHistoryUrl,
  buildGamePageUrl,
  extractGameDownloadsHref,
  isF95GamePageHtml,
  parseGameDownloadsHtml,
  parseGameHistoryHtml,
  parseGamePage,
  synthesizeChangelogHtml,
} from '../domain/game/gamePage';

const fix = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const okHeaders: Record<string, string> = {};

describe('buildGamePageUrl', () => {
  it('appends /game and is idempotent', () => {
    expect(buildGamePageUrl('https://f95zone.to/threads/68105/')).toBe(
      'https://f95zone.to/threads/68105/game',
    );
    expect(buildGamePageUrl('https://f95zone.to/threads/68105')).toBe(
      'https://f95zone.to/threads/68105/game',
    );
    expect(buildGamePageUrl('https://f95zone.to/threads/68105/game')).toBe(
      'https://f95zone.to/threads/68105/game',
    );
  });
});

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

  it('strips /game before appending game-history', () => {
    expect(
      buildGameHistoryUrl('https://f95zone.to/threads/68105/game'),
    ).toBe('https://f95zone.to/threads/68105/game-history');
    expect(
      buildGameHistoryUrl('https://f95zone.to/threads/68105/game/'),
    ).toBe('https://f95zone.to/threads/68105/game-history');
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
  const gameUrl = 'https://f95zone.to/threads/68105/game';
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
        if (url.includes('game-downloads')) {
          return {
            status: 200,
            url,
            body: '',
            headers: okHeaders,
          };
        }
        if (url.includes('/account')) {
          return {
            status: 200,
            url,
            body: '<html><input name="_xfToken" value="test-token" /></html>',
            headers: okHeaders,
          };
        }
        // Prefer /game — return game-page HTML for that URL
        if (/\/game(?:\/|$|\?)/.test(url) || url.endsWith('/game')) {
          return {
            status: 200,
            url: gameUrl,
            body: pageHtml,
            headers: okHeaders,
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

  it('fetches /game first then game-history', async () => {
    const http = makeHttp({
      body: fix('thread-game-history-desert-stalker.html'),
    });
    const detail = await new GameClient(http as never).getDetail('68105');
    expect(detail.layout).toBe('gamePage');
    expect(http.gets[0]?.url).toBe(gameUrl);
    expect(http.gets.some((g) => g.url.endsWith('/game-history'))).toBe(true);
    expect(http.gets.some((g) => g.url === threadUrl)).toBe(false);
  });

  it('falls back to classic thread URL when /game is missing', async () => {
    const classicHtml =
      '<html data-template="thread_view"><body><article class="message--side"><div class="bbWrapper">OP</div></article></body></html>';
    const gets: { url: string }[] = [];
    const http = {
      gets,
      get: async (url: string) => {
        gets.push({ url });
        if (url.endsWith('/game')) {
          return {
            status: 404,
            url,
            body: 'Not Found',
            headers: okHeaders,
          };
        }
        return {
          status: 200,
          url: threadUrl,
          body: classicHtml,
          headers: okHeaders,
        };
      },
    };
    // parseThread may throw on minimal HTML — only assert URL sequence + that
    // we attempted classic after /game 404.
    try {
      await new GameClient(http as never).getDetail('68105');
    } catch {
      // parse errors ok for this stub; URL order is what we care about
    }
    expect(gets[0]?.url).toBe(gameUrl);
    expect(gets[1]?.url).toBe(threadUrl);
  });

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

describe('f95gp game-downloads', () => {
  it('buildGameDownloadsUrl strips /game and appends query', () => {
    expect(buildGameDownloadsUrl('https://f95zone.to/threads/68105/game')).toBe(
      'https://f95zone.to/threads/68105/game-downloads?platform=0',
    );
    expect(
      buildGameDownloadsUrl('https://f95zone.to/threads/slug.68105/', 2),
    ).toBe('https://f95zone.to/threads/slug.68105/game-downloads?platform=2');
  });

  it('extracts game-downloads href from overview download section', () => {
    const href = extractGameDownloadsHref(`
      <section id="f95gp-download">
        <a href="/threads/slug.68105/game-downloads?platform=0" class="f95gp-dlButton js-f95gpDlButton">Download</a>
        <span class="js-f95gpDlOption" hidden data-os="apple" data-href="/threads/slug.68105/game-downloads?platform=1"></span>
      </section>
    `);
    expect(href).toBe(
      'https://f95zone.to/threads/slug.68105/game-downloads?platform=0',
    );
  });

  it('parses platform tabs and More downloads extras', () => {
    const downloads = parseGameDownloadsHtml(
      fix('thread-game-downloads-desert-stalker.html'),
    );
    expect(downloads.filter((d) => d.platform === 'Win/Linux').length).toBe(5);
    expect(downloads.filter((d) => d.platform === 'Mac').length).toBe(2);
    expect(downloads.filter((d) => d.platform === 'Android').length).toBe(2);
    expect(
      downloads.some(
        (d) => d.host === 'mega' && d.platform === 'Win/Linux' && d.kindHint === 'full',
      ),
    ).toBe(true);

    const patches = downloads.filter((d) => d.kindHint === 'patch');
    expect(patches.length).toBe(2);
    expect(patches[0]?.group).toMatch(/Update Only/i);

    const extras = downloads.filter((d) => d.kindHint === 'extra');
    expect(extras.length).toBe(2);
    expect(extras.some((d) => /Walkthrough/i.test(d.text))).toBe(true);
    expect(extras.every((d) => d.group === 'Extras')).toBe(true);
  });

  it('getDetail fills downloads from game-downloads overlay', async () => {
    const gameUrl = 'https://f95zone.to/threads/68105/game';
    const pageHtml = fix('thread-game-page-desert-stalker.html').replace(
      /<div class="blockMessage f95gp-guest">[\s\S]*?<\/div>/,
      `<div class="f95gp-dlMain js-f95gpDlMain">
        <a href="/threads/desert-stalker.68105/game-downloads?platform=0" class="f95gp-dlButton js-f95gpDlButton">Download</a>
      </div>`,
    );
    const gets: string[] = [];
    const http = {
      get: async (url: string) => {
        gets.push(url);
        if (url.includes('game-history')) {
          return { status: 404, url, body: '', headers: okHeaders };
        }
        if (url.includes('game-downloads')) {
          // Plain GET fallback after ajax token load fails in this stub.
          return {
            status: 200,
            url,
            body: fix('thread-game-downloads-desert-stalker.html'),
            headers: okHeaders,
          };
        }
        if (url.includes('/account')) {
          return {
            status: 200,
            url,
            body: '<html><input name="_xfToken" value="test-token" /></html>',
            headers: okHeaders,
          };
        }
        if (url.endsWith('/game') || url.includes('/game?') || url.includes('/game&')) {
          return { status: 200, url: gameUrl, body: pageHtml, headers: okHeaders };
        }
        // Ajax downloads URL includes _xfResponseType=json
        if (url.includes('_xfResponseType=json') && url.includes('game-downloads')) {
          return {
            status: 200,
            url,
            body: JSON.stringify({
              status: 'ok',
              html: { content: fix('thread-game-downloads-desert-stalker.html') },
            }),
            headers: okHeaders,
          };
        }
        return { status: 404, url, body: '', headers: okHeaders };
      },
    };
    const detail = await new GameClient(http as never).getDetail('68105');
    expect(detail.layout).toBe('gamePage');
    expect(gets.some((u) => u.includes('game-downloads'))).toBe(true);
    expect(detail.downloads.length).toBeGreaterThan(5);
    expect(detail.downloads.some((d) => d.platform === 'Win/Linux')).toBe(true);
    expect(detail.downloads.some((d) => d.kindHint === 'extra')).toBe(true);
  });

  it('getDetail still fetches game-downloads when overview is guest (URL fallback)', async () => {
    const gameUrl = 'https://f95zone.to/threads/68105/game';
    const pageHtml = fix('thread-game-page-desert-stalker.html'); // guest download section
    const gets: string[] = [];
    const http = {
      get: async (url: string) => {
        gets.push(url);
        if (url.includes('game-history')) {
          return { status: 404, url, body: '', headers: okHeaders };
        }
        if (url.includes('/account')) {
          return {
            status: 200,
            url,
            body: '<html><input name="_xfToken" value="tok" /></html>',
            headers: okHeaders,
          };
        }
        if (url.includes('game-downloads')) {
          return {
            status: 200,
            url,
            body: JSON.stringify({
              status: 'ok',
              html: { content: fix('thread-game-downloads-desert-stalker.html') },
            }),
            headers: okHeaders,
          };
        }
        if (url.includes('/game')) {
          return { status: 200, url: gameUrl, body: pageHtml, headers: okHeaders };
        }
        return { status: 404, url, body: '', headers: okHeaders };
      },
    };
    const detail = await new GameClient(http as never).getDetail('68105');
    expect(gets.some((u) => u.includes('game-downloads'))).toBe(true);
    expect(detail.downloads.some((d) => d.host === 'mega')).toBe(true);
  });
});
