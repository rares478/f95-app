import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { normalizeOpHtml } from '../domain/game/htmlNormalize';

describe('normalizeOpHtml media embeds', () => {
  it('converts giphy iframes into img tags', () => {
    const html = `
      <div class="bbWrapper">
        <div class="bbMediaWrapper">
          <div class="bbMediaWrapper-inner">
            <iframe src="https://giphy.com/embed/abc123" width="500" height="375"></iframe>
          </div>
        </div>
      </div>`;
    const $ = cheerio.load(html);
    const out = normalizeOpHtml($, $('.bbWrapper').first());
    expect(out).toContain('https://media.giphy.com/media/abc123/giphy.gif');
    expect(out).not.toContain('<iframe');
  });

  it('falls back to data-url when data-src is missing', () => {
    const html = `
      <div class="bbWrapper">
        <img src="data:image/gif;base64,R0lGODlh" data-url="/attachments/shot.jpg" class="bbImage" />
      </div>`;
    const $ = cheerio.load(html);
    const out = normalizeOpHtml($, $('.bbWrapper').first());
    expect(out).toContain('https://f95zone.to/attachments/shot.jpg');
  });

  it('materializes empty bbImageWrapper[data-src] into img tags', () => {
    const html = `
      <div class="bbWrapper">
        <div class="bbImageWrapper js-lbImage" title="BTTM.jpg"
          data-src="https://attachments.f95zone.to/2020/11/918065_bttm.png"
          data-type="image"></div>
      </div>`;
    const $ = cheerio.load(html);
    const out = normalizeOpHtml($, $('.bbWrapper').first());
    expect(out).toContain(
      'src="https://attachments.f95zone.to/2020/11/918065_bttm.png"',
    );
    expect(out).toContain('<img');
    expect(out).not.toContain('bbImageWrapper');
  });

  it('drops empty height-reserved bbImageWrapper and does not keep height style', () => {
    const html = `
      <div class="bbWrapper">
        <div style="text-align: center">
          <div class="bbImageWrapper js-lbImage" title="main_menu.png"
            data-src="https://attachments.f95zone.to/2026/10/6576513_main_menu.png"
            data-type="image" style="height: 500px; width: auto"></div>
          <br><b>Overview</b>:<br>Story text
        </div>
      </div>`;
    const $ = cheerio.load(html);
    const omitted = normalizeOpHtml(
      $,
      $('.bbWrapper').first(),
      new Set(['https://attachments.f95zone.to/2026/10/6576513_main_menu.png']),
    );
    expect(omitted).not.toContain('bbImageWrapper');
    expect(omitted).not.toContain('height: 500px');
    expect(omitted).toContain('<b>Overview</b>');

    const stripped = normalizeOpHtml($, $('.bbWrapper').first());
    expect(stripped).not.toContain('<img');
    expect(stripped).not.toContain('6576513_main_menu.png');
    expect(stripped).not.toContain('bbImageWrapper');
    expect(stripped).not.toContain('height: 500px');
    expect(stripped).toContain('<b>Overview</b>');
  });

  it('unwraps bbImageWrapper that already contains an img so height cannot linger', () => {
    const html = `
      <div class="bbWrapper">
        <div class="bbImageWrapper js-lbImage" style="height: 500px; width: auto"
          data-src="https://attachments.f95zone.to/2024/01/shot.png">
          <img src="data:image/gif;base64,R0lGODlh"
            data-src="https://attachments.f95zone.to/2024/01/shot.png"
            class="bbImage" />
        </div>
        <b>Overview</b>: story
      </div>`;
    const $ = cheerio.load(html);
    const out = normalizeOpHtml($, $('.bbWrapper').first());
    expect(out).not.toContain('<img');
    expect(out).not.toContain('bbImageWrapper');
    expect(out).not.toContain('height: 500px');
    expect(out).toContain('<b>Overview</b>');
  });

  it('keeps images that appear after Overview', () => {
    const html = `
      <div class="bbWrapper">
        <img src="https://attachments.f95zone.to/2024/01/banner.png" />
        <b>Overview</b>: story<br>
        <img src="https://attachments.f95zone.to/2024/01/inline.png" />
      </div>`;
    const $ = cheerio.load(html);
    const out = normalizeOpHtml($, $('.bbWrapper').first());
    expect(out).not.toContain('banner.png');
    expect(out).toContain('inline.png');
    expect(out).toContain('<b>Overview</b>');
  });
});
