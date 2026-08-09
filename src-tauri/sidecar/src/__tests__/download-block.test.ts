import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { parseDownloadBlock } from '../domain/game/downloadBlock';

function loadRoot(name: string) {
  const html = readFileSync(join(__dirname, 'fixtures', name), 'utf8');
  const $ = cheerio.load(html);
  const root = $('.download-root').first() as cheerio.Cheerio<Element>;
  return { $, root };
}

function byUrl(downloads: { url: string }[], frag: string) {
  return downloads.filter((d) => d.url.includes(frag));
}

describe('parseDownloadBlock — basic rows', () => {
  it('groups mirrors under bold platform rows as Current full', () => {
    const { $, root } = loadRoot('download-block-basic.html');
    const downloads = parseDownloadBlock($, root);

    const win = byUrl(downloads, 'basic-win');
    expect(win).toHaveLength(2);
    expect(win[0]).toMatchObject({
      edition: null,
      platform: 'Win/Linux',
      part: null,
      kindHint: 'full',
      group: 'Win/Linux',
      topLevel: true,
    });
    expect(win.map((d) => d.host).sort()).toEqual(['gofile', 'mega']);

    expect(byUrl(downloads, 'basic-mac')[0]).toMatchObject({
      platform: 'Mac',
      edition: null,
      topLevel: true,
      kindHint: 'full',
    });
    expect(byUrl(downloads, 'basic-android')[0]).toMatchObject({
      platform: 'Android (Compressed)',
      kindHint: 'full',
      topLevel: true,
    });
  });
});

describe('parseDownloadBlock — nested spoilers', () => {
  it('keeps Current separate from spoiler edition platform rows', () => {
    const { $, root } = loadRoot('download-block-nested.html');
    const downloads = parseDownloadBlock($, root);

    expect(byUrl(downloads, 'nested-current-win')[0]).toMatchObject({
      edition: null,
      platform: 'Win/Linux',
      topLevel: true,
      kindHint: 'full',
    });
    expect(byUrl(downloads, 'nested-s12-win')[0]).toMatchObject({
      edition: 'Season 1 - 2',
      platform: 'Win/Linux',
      topLevel: false,
      kindHint: 'full',
    });
    expect(byUrl(downloads, 'nested-s12-mac')[0]).toMatchObject({
      edition: 'Season 1 - 2',
      platform: 'Mac',
      topLevel: false,
    });
  });

  it('uses preceding bold when spoiler title is generic Spoiler', () => {
    const { $, root } = loadRoot('download-block-nested.html');
    const downloads = parseDownloadBlock($, root);
    expect(byUrl(downloads, 'nested-s3-p1')[0]).toMatchObject({
      edition: 'Season 3 splits',
      platform: 'Win/Linux',
      part: 1,
      kindHint: 'split',
      topLevel: false,
    });
  });
});
