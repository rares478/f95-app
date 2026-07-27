import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { resolveDownloadPath } from '../domain/game/client';

const html = readFileSync(
  join(__dirname, 'fixtures', 'download-path-multi-season.html'),
  'utf8',
);

function pathFor(urlFragment: string) {
  const $ = cheerio.load(html);
  const el = $(`a[href*="${urlFragment}"]`).get(0) as Element | undefined;
  if (!el) throw new Error(`missing link ${urlFragment}`);
  return resolveDownloadPath($, el);
}

describe('resolveDownloadPath', () => {
  it('keeps Season 3 full Win/Linux separate from Season 1-2 Win/Linux', () => {
    const top = pathFor('s3-win-full');
    expect(top).toMatchObject({
      edition: null,
      platform: 'Win/Linux',
      part: null,
      kindHint: 'full',
      group: 'Win/Linux',
    });

    const s12 = pathFor('s12-win-full');
    expect(s12).toMatchObject({
      edition: 'Season 1 - 2',
      platform: 'Win/Linux',
      part: null,
      kindHint: 'full',
      group: 'Season 1 - 2 · Win/Linux',
    });
  });

  it('labels Mac top-level as full platform', () => {
    expect(pathFor('s3-mac-full')).toMatchObject({
      edition: null,
      platform: 'Mac',
      part: null,
      kindHint: 'full',
      group: 'Mac',
    });
  });

  it('labels split parts under outer season edition', () => {
    expect(pathFor('s12-win-p1')).toMatchObject({
      edition: 'Season 1 - 2',
      platform: 'Win/Linux',
      part: 1,
      kindHint: 'split',
      group: 'Season 1 - 2 · Win/Linux · Part 1',
    });
    expect(pathFor('s12-win-p2')).toMatchObject({
      edition: 'Season 1 - 2',
      platform: 'Win/Linux',
      part: 2,
      kindHint: 'split',
      group: 'Season 1 - 2 · Win/Linux · Part 2',
    });
  });

  it('uses preceding text when spoiler title is generic', () => {
    expect(pathFor('s3-win-p1')).toMatchObject({
      edition: 'Season 3 splits',
      platform: 'Win/Linux',
      part: 1,
      kindHint: 'split',
      group: 'Season 3 splits · Win/Linux · Part 1',
    });
  });

  it('emits patch and extra kindHints', () => {
    expect(pathFor('patch-win')).toMatchObject({
      kindHint: 'patch',
    });
    expect(pathFor('extra-pack')).toMatchObject({
      kindHint: 'extra',
    });
  });

  it('uses outer-only SPLIT spoiler title as edition', () => {
    expect(pathFor('outer-split-p1')).toMatchObject({
      edition: 'SPLIT-S3',
      platform: 'Win/Linux',
      part: 1,
      kindHint: 'split',
      group: 'SPLIT-S3 · Win/Linux · Part 1',
    });
  });

  it('skips prior spoilers when resolving top-level edition', () => {
    expect(pathFor('archive-spoiler-win')).toMatchObject({
      edition: 'Old builds',
      platform: 'Win/Linux',
      kindHint: 'full',
      topLevel: false,
    });
    expect(pathFor('after-spoiler-win')).toMatchObject({
      edition: 'Archive',
      platform: 'Win/Linux',
      part: null,
      kindHint: 'full',
      group: 'Archive · Win/Linux',
      topLevel: true,
    });
  });

  it('marks unnamed Current as topLevel', () => {
    expect(pathFor('s3-win-full')).toMatchObject({
      edition: null,
      topLevel: true,
    });
  });

  it('marks spoiler seasons as not topLevel', () => {
    expect(pathFor('s12-win-full')).toMatchObject({
      edition: 'Season 1 - 2',
      topLevel: false,
    });
  });

  it('does not treat dispatch/modern substrings as patch/extra', () => {
    const dispatch = pathFor('dispatch-notes');
    expect(dispatch.kindHint).not.toBe('patch');
    expect(dispatch.kindHint).not.toBe('extra');
    const modern = pathFor('modern-build');
    expect(modern.kindHint).not.toBe('patch');
    expect(modern.kindHint).not.toBe('extra');
  });
});

describe('resolveDownloadPath — Eternum real markup', () => {
  const eternumHtml = readFileSync(
    join(__dirname, 'fixtures', 'download-path-eternum-real.html'),
    'utf8',
  );

  function eternumPath(urlFragment: string) {
    const $ = cheerio.load(eternumHtml);
    const el = $(`a[href*="${urlFragment}"]`).get(0) as Element | undefined;
    if (!el) throw new Error(`missing link ${urlFragment}`);
    return resolveDownloadPath($, el);
  }

  it('keeps top-level full builds as Current Win/Linux (not Fan Signatures)', () => {
    expect(eternumPath('Eternum-0.9.5-pc.zip')).toMatchObject({
      edition: null,
      platform: 'Win/Linux',
      part: null,
      kindHint: 'full',
      group: 'Win/Linux',
      topLevel: true,
    });
  });

  it('reads Splits from preceding bold when button title is Spoiler', () => {
    expect(eternumPath('Eternum-0.9.5-pc.zip.part1.rar')).toMatchObject({
      edition: 'Splits',
      platform: 'Win/Linux',
      part: 1,
      kindHint: 'split',
      group: 'Splits · Win/Linux · Part 1',
    });
  });

  it('does not mislabel Win/Linux parts as Android', () => {
    expect(eternumPath('Eternum-0.9.5-pc.zip.part2.rar').platform).toBe('Win/Linux');
    expect(eternumPath('Eternum-0.9.5-mac.zip.part1.rar')).toMatchObject({
      platform: 'Mac',
      part: 1,
      edition: 'Splits',
    });
  });

  it('labels soundtrack spoiler from preceding version heading', () => {
    expect(eternumPath('ost-win')).toMatchObject({
      edition: 'v0.8.5 (Original Soundtrack)',
      platform: 'Win/Linux',
      part: null,
    });
  });
});

describe('resolveDownloadPath — Being a DIK patch vs season', () => {
  const dikHtml = readFileSync(
    join(__dirname, 'fixtures', 'download-path-dik-patch.html'),
    'utf8',
  );

  function dikPath(urlFragment: string) {
    const $ = cheerio.load(dikHtml);
    const el = $(`a[href*="${urlFragment}"]`).get(0) as Element | undefined;
    if (!el) throw new Error(`missing link ${urlFragment}`);
    return resolveDownloadPath($, el);
  }

  it('keeps Season 3 full separate from Patch rows', () => {
    expect(dikPath('s3-full-win')).toMatchObject({
      edition: 'Season 3 Interlude + Episode 11',
      platform: 'Win/Linux',
      part: null,
      kindHint: 'full',
    });
    expect(dikPath('patch-ep11')).toMatchObject({
      kindHint: 'patch',
      platform: 'Win/Linux',
    });
    expect(dikPath('patch-ep11').edition).toMatch(/Patch/i);
    expect(dikPath('patch-ep10')).toMatchObject({
      kindHint: 'patch',
      platform: 'Win/Linux',
    });
  });

  it('does not put patch hosts in the Season 3 full group', () => {
    expect(dikPath('patch-ep11').group).not.toContain('Season 3');
    expect(dikPath('s3-full-win').kindHint).toBe('full');
  });
});

describe('resolveDownloadPath — Hard to Love nested acts', () => {
  const htlHtml = readFileSync(
    join(__dirname, 'fixtures', 'download-path-hard-to-love.html'),
    'utf8',
  );

  function htlPath(urlFragment: string) {
    const $ = cheerio.load(htlHtml);
    const el = $(`a[href*="${urlFragment}"]`).get(0) as Element | undefined;
    if (!el) throw new Error(`missing link ${urlFragment}`);
    return resolveDownloadPath($, el);
  }

  it('keeps Act2 current separate from Act 1 spoiler content', () => {
    expect(htlPath('act2-win')).toMatchObject({
      edition: 'Act2',
      platform: 'Win/Linux',
      kindHint: 'full',
      topLevel: true,
    });
  });

  it('splits Act 1 High vs Low quality', () => {
    expect(htlPath('act1-hq-win')).toMatchObject({
      edition: 'Act 1 (v1.0) · High Quality',
      platform: 'Win/Linux',
      kindHint: 'full',
    });
    expect(htlPath('act1-lq-win')).toMatchObject({
      edition: 'Act 1 (v1.0) · Low Quality',
      platform: 'Win/Linux',
      kindHint: 'full',
    });
    expect(htlPath('act1-hq-win').edition).not.toBe(htlPath('act1-lq-win').edition);
  });

  it('does not lump Before Remake seasons into Act 1', () => {
    expect(htlPath('s2-win')).toMatchObject({
      edition: 'Before Remake · SEASON 2',
      platform: 'Win/Linux',
    });
    expect(htlPath('s1-win')).toMatchObject({
      edition: 'Before Remake · SEASON 1',
      platform: 'Win/Linux',
    });
    expect(htlPath('s2-win').edition).not.toMatch(/Act 1/i);
    expect(htlPath('act1-hq-win').edition).not.toMatch(/SEASON/i);
  });
});

describe('resolveDownloadPath — Love of Magic Win64 labels', () => {
  const lomHtml = `
  <div class="bbWrapper">
    <b>DOWNLOAD</b><br/>
    <b>Book 3 (Act XI-XVI and New Game+)</b><br/>
    <b>Win64:</b> <a href="https://mega.nz/file/lom-b3-win">MEGA</a><br/>
    <b>OSX:</b> <a href="https://mega.nz/file/lom-b3-mac">MEGA</a><br/>
    <b>Linux:</b> <a href="https://mega.nz/file/lom-b3-linux">MEGA</a><br/>
    <b>Android (v0.2.5b):</b> <a href="https://mega.nz/file/lom-b3-android">MEGA</a>
  </div>`;

  function lomPath(urlFragment: string) {
    const $ = cheerio.load(lomHtml);
    const el = $(`a[href*="${urlFragment}"]`).get(0) as Element | undefined;
    if (!el) throw new Error(`missing link ${urlFragment}`);
    return resolveDownloadPath($, el);
  }

  it('detects Win64 rows as desktop platform', () => {
    expect(lomPath('lom-b3-win')).toMatchObject({
      edition: 'Book 3 (Act XI-XVI and New Game+)',
      platform: 'Win64',
      kindHint: 'full',
    });
  });

  it('detects OSX rows as Mac platform label', () => {
    expect(lomPath('lom-b3-mac')).toMatchObject({
      platform: 'OSX',
      kindHint: 'full',
    });
  });
});
