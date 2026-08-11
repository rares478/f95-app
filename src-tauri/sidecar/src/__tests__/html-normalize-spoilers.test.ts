import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { normalizeOpHtml } from '../domain/game/htmlNormalize';

describe('normalizeOpHtml spoilers', () => {
  it('rewrites XF spoiler blocks into native details', () => {
    const html = `
      <div class="bbWrapper">
        <div class="bbCodeSpoiler">
          <button type="button" class="bbCodeSpoiler-button">
            <span class="bbCodeSpoiler-button-title">Changelog</span>
          </button>
          <div class="bbCodeSpoiler-content">
            <div class="bbCodeBlock bbCodeBlock--spoiler">
              <div class="bbCodeBlock-content">v1.0 notes</div>
            </div>
          </div>
        </div>
      </div>`;
    const $ = cheerio.load(html);
    const out = normalizeOpHtml($, $('.bbWrapper').first());
    expect(out).toContain('class="x-spoiler"');
    expect(out).toContain('<summary>Changelog</summary>');
    expect(out).toContain('v1.0 notes');
    expect(out).not.toContain('bbCodeSpoiler');
  });

  it('normalizes nested spoilers deepest-first (changelog-style)', () => {
    const html = `
      <div class="bbWrapper">
        <b>Changelog</b>:<br />
        <div class="bbCodeSpoiler">
          <button type="button" class="bbCodeSpoiler-button"><span>Spoiler</span></button>
          <div class="bbCodeSpoiler-content">
            <div class="bbCodeBlock bbCodeBlock--spoiler">
              <div class="bbCodeBlock-content">
                -- outer --<br />
                <b>v0.8.3</b><br />
                <div class="bbCodeSpoiler">
                  <button type="button" class="bbCodeSpoiler-button"><span>Spoiler</span></button>
                  <div class="bbCodeSpoiler-content">
                    <div class="bbCodeBlock bbCodeBlock--spoiler">
                      <div class="bbCodeBlock-content">inner changelog</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    const $ = cheerio.load(html);
    const out = normalizeOpHtml($, $('.bbWrapper').first());
    expect(out.match(/class="x-spoiler"/g)?.length).toBe(2);
    expect(out).toContain('inner changelog');
    expect(out).toContain('-- outer --');
    expect(out).not.toContain('bbCodeSpoiler');
    expect(out).not.toContain('bbCodeSpoiler-button');
  });
});
