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

describe('parseDownloadBlock — kinds and wrapped labels', () => {
  it('reads platform from bold inside styled span', () => {
    const { $, root } = loadRoot('download-block-kinds.html');
    const downloads = parseDownloadBlock($, root);
    expect(byUrl(downloads, 'kinds-win')[0]).toMatchObject({
      platform: 'Win/Linux',
      topLevel: true,
      kindHint: 'full',
    });
  });

  it('marks patch and extra kinds', () => {
    const { $, root } = loadRoot('download-block-kinds.html');
    const downloads = parseDownloadBlock($, root);
    expect(byUrl(downloads, 'kinds-patch')[0]).toMatchObject({
      kindHint: 'patch',
      platform: 'Win/Linux',
      topLevel: false,
    });
    expect(byUrl(downloads, 'kinds-extra')[0]).toMatchObject({
      kindHint: 'extra',
      topLevel: false,
    });
  });

  it('labels OST spoiler from preceding heading', () => {
    const { $, root } = loadRoot('download-block-kinds.html');
    const downloads = parseDownloadBlock($, root);
    expect(byUrl(downloads, 'kinds-ost-win')[0]).toMatchObject({
      edition: 'v0.8.5 (Original Soundtrack)',
      platform: 'Win/Linux',
      kindHint: 'extra',
      topLevel: false,
    });
  });

  it('assigns split parts under Splits spoiler', () => {
    const { $, root } = loadRoot('download-block-kinds.html');
    const downloads = parseDownloadBlock($, root);
    expect(byUrl(downloads, 'kinds-p1')[0]).toMatchObject({
      edition: 'Splits',
      platform: 'Win/Linux',
      part: 1,
      kindHint: 'split',
    });
    expect(byUrl(downloads, 'kinds-p2')[0]).toMatchObject({
      part: 2,
      kindHint: 'split',
    });
  });

  it('does not treat dispatch/modern substrings as patch/extra', () => {
    const { $, root } = loadRoot('download-block-kinds.html');
    const downloads = parseDownloadBlock($, root);
    const dispatch = byUrl(downloads, 'dispatch-notes')[0];
    expect(dispatch?.kindHint).not.toBe('patch');
    expect(dispatch?.kindHint).not.toBe('extra');
    const modern = byUrl(downloads, 'modern-build')[0];
    expect(modern?.kindHint).not.toBe('patch');
    expect(modern?.kindHint).not.toBe('extra');
  });

  it('preserves Win64 and OSX platform labels as written', () => {
    const { $, root } = loadRoot('download-block-kinds.html');
    const downloads = parseDownloadBlock($, root);
    expect(byUrl(downloads, 'lom-b3-win')[0]).toMatchObject({
      edition: 'Book 3 (Act XI-XVI and New Game+)',
      platform: 'Win64',
      kindHint: 'full',
    });
    expect(byUrl(downloads, 'lom-b3-mac')[0]).toMatchObject({
      platform: 'OSX',
      kindHint: 'full',
    });
  });
});

describe('parseDownloadBlock — Hard to Love nested acts', () => {
  it('labels Act2 current and composes Act 1 quality editions', () => {
    const { $, root } = loadRoot('download-block-hard-to-love.html');
    const downloads = parseDownloadBlock($, root);

    const act2 = byUrl(downloads, 'act2-win')[0];
    expect(act2).toMatchObject({
      platform: 'Win/Linux',
      kindHint: 'full',
      topLevel: true,
    });
    expect(act2.edition).toMatch(/Act\s*2/i);

    const hq = byUrl(downloads, 'act1-hq-win')[0];
    expect(hq).toMatchObject({
      platform: 'Win/Linux',
      kindHint: 'full',
      topLevel: false,
    });
    expect(hq.edition).toMatch(/Act\s*1/i);
    expect(hq.edition).toMatch(/High Quality/i);

    const lq = byUrl(downloads, 'act1-lq-win')[0];
    expect(lq).toMatchObject({
      platform: 'Win/Linux',
      kindHint: 'full',
      topLevel: false,
    });
    expect(lq.edition).toMatch(/Act\s*1/i);
    expect(lq.edition).toMatch(/Low Quality/i);
    expect(lq.edition).not.toMatch(/High Quality/i);
  });

  it('does not lump Before Remake seasons into Act 1', () => {
    const { $, root } = loadRoot('download-block-hard-to-love.html');
    const downloads = parseDownloadBlock($, root);
    expect(byUrl(downloads, 's2-win')[0]).toMatchObject({
      edition: 'SEASON 2',
      platform: 'Win/Linux',
    });
    expect(byUrl(downloads, 's1-win')[0]).toMatchObject({
      edition: 'SEASON 1',
      platform: 'Win/Linux',
    });
    expect(byUrl(downloads, 's2-win')[0].edition).not.toMatch(/Act 1/i);
    expect(byUrl(downloads, 'act1-hq-win')[0].edition).not.toMatch(/SEASON/i);
  });
});
