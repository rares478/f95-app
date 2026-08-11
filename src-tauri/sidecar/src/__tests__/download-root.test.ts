import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import {
  parseDownloadBlock,
  resolveDownloadRoot,
  rootHasDirectHost,
} from '../domain/game/downloadBlock';
import { classifyHost } from '../domain/game/hosts';
import { absoluteUrl } from '../domain/game/htmlNormalize';

const scoped = readFileSync(
  join(__dirname, 'fixtures', 'download-root-scoped.html'),
  'utf8',
);

describe('scoped extraction integration', () => {
  it('excludes Developer Notes mega and keeps real download hosts', () => {
    const $ = cheerio.load(scoped);
    const opBody = $('.message-body .bbWrapper').first() as cheerio.Cheerio<Element>;
    const root = resolveDownloadRoot($, opBody);
    expect(root).not.toBeNull();
    const downloads = parseDownloadBlock($, root!);
    expect(downloads.every((d) => !d.url.includes('notes-pollution'))).toBe(true);
    expect(downloads.some((d) => d.url.includes('real-win'))).toBe(true);
  });

  it('still finds social links outside the download root', () => {
    const $ = cheerio.load(scoped);
    const opBody = $('.message-body .bbWrapper').first();
    const social: string[] = [];
    opBody.find('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const info = classifyHost(absoluteUrl(href));
      if (info?.category === 'social') social.push(info.host);
    });
    expect(social).toContain('patreon');
  });
});

describe('resolveDownloadRoot', () => {
  it('prefers the last bbWrapper div when it has host links', () => {
    const $ = cheerio.load(scoped);
    const opBody = $('.message-body .bbWrapper').first() as cheerio.Cheerio<Element>;
    const root = resolveDownloadRoot($, opBody);
    expect(root).not.toBeNull();
    expect(root!.text()).toMatch(/DOWNLOAD/);
    expect(root!.find('a[href*="real-win"]').length).toBeGreaterThan(0);
    expect(root!.find('a[href*="notes-pollution"]').length).toBe(0);
  });

  it('falls back from DOWNLOAD heading when last div has no hosts', () => {
    const html = `
      <div class="bbWrapper">
        <b>DOWNLOAD</b><br />
        <b>Win/Linux:</b>
        <a href="https://mega.nz/file/fallback-win">MEGA</a>
        <div>footer note without hosts</div>
      </div>`;
    const $ = cheerio.load(html);
    const opBody = $('.bbWrapper').first() as cheerio.Cheerio<Element>;
    const root = resolveDownloadRoot($, opBody);
    expect(root).not.toBeNull();
    expect(root!.find('a[href*="fallback-win"]').length).toBe(1);
    expect(rootHasDirectHost($, opBody.children('div').last())).toBe(false);
  });

  it('returns null when neither last div nor DOWNLOAD heading yields hosts', () => {
    const html = `<div class="bbWrapper"><b>Overview</b><br /><p>No files</p></div>`;
    const $ = cheerio.load(html);
    const opBody = $('.bbWrapper').first() as cheerio.Cheerio<Element>;
    expect(resolveDownloadRoot($, opBody)).toBeNull();
  });
});
