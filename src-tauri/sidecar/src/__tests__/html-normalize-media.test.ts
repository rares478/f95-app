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
});
