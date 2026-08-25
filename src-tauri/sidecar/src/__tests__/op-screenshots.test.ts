import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { resolveDownloadRoot } from '../domain/game/downloadBlock';
import { resolveBannerAndScreenshots } from '../domain/game/client';

describe('resolveBannerAndScreenshots', () => {
  it('uses only images from the download div, ignoring description images', () => {
    const html = `
<article class="message">
  <div class="message-body">
    <div class="bbWrapper">
      <div style="text-align: center">
        <img src="https://attachments.f95zone.to/2024/02/banner.jpg" class="bbImage" alt="Banner" />
        <br />
        <b>Overview</b><br />
        Story art:
        <img src="https://attachments.f95zone.to/2023/01/desc-shot.png" class="bbImage" alt="desc" />
      </div>
      <div style="text-align: center">
        <b>DOWNLOAD</b><br />
        <a href="https://gofile.io/d/abc">GOFILE</a>
        <br />
        <a href="https://attachments.f95zone.to/2023/03/shot1.png" class="js-lbImage">
          <img data-src="https://attachments.f95zone.to/2023/03/thumb/shot1.png" class="bbImage lazyload" alt="shot1" />
        </a>
        <a href="https://attachments.f95zone.to/2023/03/shot2.png" class="js-lbImage">
          <img data-src="https://attachments.f95zone.to/2023/03/thumb/shot2.png" class="bbImage lazyload" alt="shot2" />
        </a>
      </div>
    </div>
  </div>
</article>`;
    const $ = cheerio.load(html);
    const opBody = $('.message-body .bbWrapper').first() as cheerio.Cheerio<Element>;
    const root = resolveDownloadRoot($, opBody);
    expect(root).not.toBeNull();
    const { bannerUrl, screenshots } = resolveBannerAndScreenshots($, opBody, root);
    expect(bannerUrl).toBe('https://attachments.f95zone.to/2024/02/banner.jpg');
    expect(screenshots).toEqual([
      'https://attachments.f95zone.to/2023/03/shot1.png',
      'https://attachments.f95zone.to/2023/03/shot2.png',
    ]);
    expect(screenshots.join(' ')).not.toContain('desc-shot');
  });

  it('returns no screenshots when there is no download root', () => {
    const html = `
<article class="message">
  <div class="message-body">
    <div class="bbWrapper">
      <img src="https://attachments.f95zone.to/2024/02/banner.jpg" class="bbImage" />
      <img src="https://attachments.f95zone.to/2023/01/desc.png" class="bbImage" />
    </div>
  </div>
</article>`;
    const $ = cheerio.load(html);
    const opBody = $('.message-body .bbWrapper').first() as cheerio.Cheerio<Element>;
    const { bannerUrl, screenshots } = resolveBannerAndScreenshots($, opBody, null);
    expect(bannerUrl).toBe('https://attachments.f95zone.to/2024/02/banner.jpg');
    expect(screenshots).toEqual([]);
  });

  it('picks screenshots from the real Twisted Memories download div', () => {
    const html = readFileSync(join(__dirname, '../..', 'thread-tm-129520.html'), 'utf8');
    const $ = cheerio.load(html);
    const opBody = $('.message-body .bbWrapper').first() as cheerio.Cheerio<Element>;
    const root = resolveDownloadRoot($, opBody);
    expect(root).not.toBeNull();
    const { bannerUrl, screenshots } = resolveBannerAndScreenshots($, opBody, root);
    expect(bannerUrl).toContain('Banner.jpg');
    expect(screenshots.length).toBeGreaterThan(0);
    expect(screenshots.every((u) => /screenshot/i.test(u))).toBe(true);
    expect(screenshots.some((u) => /Banner/i.test(u))).toBe(false);
  });
});
