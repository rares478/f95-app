import { describe, expect, it } from 'vitest';
import { parseThreadHtmlForTests } from '../domain/game/client';

const THREAD_URL = 'https://f95zone.to/threads/sample.123/';

function wrapOp(bodyInner: string): string {
  return `<html><body>
  <h1 class="p-title-value">Sample Game</h1>
  <article class="message" data-author="Dev">
    <div class="message-userDetails">
      <h4 class="message-name"><a href="/members/dev.1/" data-user-id="1">Dev</a></h4>
    </div>
    <div class="message-body"><div class="bbWrapper">${bodyInner}</div></div>
  </article>
</body></html>`;
}

describe('GameDetail.changelogHtml', () => {
  it('extracts outer spoiler after Changelog heading, including nested spoilers', () => {
    const html = wrapOp(`
      <b>Overview</b>: A game<br />
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
      <b>Version</b>: 0.8.3
    `);
    const detail = parseThreadHtmlForTests(html, THREAD_URL);
    expect(detail.changelogHtml).toBeTruthy();
    expect(detail.changelogHtml!).toContain('-- outer --');
    expect(detail.changelogHtml!).toContain('inner changelog');
    // Outer spoiler is unwrapped (UI provides "Show changelog"); nested remain.
    expect(detail.changelogHtml!).not.toMatch(/^\s*<details\b/);
    expect(detail.changelogHtml!.match(/class="x-spoiler"/g)?.length).toBe(1);
    expect(detail.changelogHtml!).toContain('<summary>Spoiler</summary>');
    // Description still includes changelog (not stripped).
    expect(detail.descriptionHtml).toContain('-- outer --');
  });

  it('returns null when Changelog heading has no following spoiler', () => {
    const html = wrapOp(`<b>Changelog</b>: none yet<br /><b>Version</b>: 1.0`);
    const detail = parseThreadHtmlForTests(html, THREAD_URL);
    expect(detail.changelogHtml).toBeNull();
  });

  it('returns null when there is no Changelog heading', () => {
    const html = wrapOp(`<b>Overview</b>: hi<br /><b>Version</b>: 1.0`);
    const detail = parseThreadHtmlForTests(html, THREAD_URL);
    expect(detail.changelogHtml).toBeNull();
  });
});
