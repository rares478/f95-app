import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isF95GamePageHtml, parseGamePage } from '../domain/game/gamePage';

const fix = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('parseGamePage', () => {
  it('detects f95gp_game template', () => {
    expect(isF95GamePageHtml(fix('thread-game-page-desert-stalker.html'))).toBe(
      true,
    );
    expect(isF95GamePageHtml('<html data-template="thread_view"></html>')).toBe(
      false,
    );
  });

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
});
