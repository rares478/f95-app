import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { normalizeOpHtml } from '../domain/game/htmlNormalize';

describe('normalizeOpHtml quotes', () => {
  it('rewrites XF quote blocks into expandable x-quote markup', () => {
    const html = `
      <div class="bbWrapper">
        <blockquote class="bbCodeBlock bbCodeBlock--expandable bbCodeBlock--quote">
          <div class="bbCodeBlock-title"><a href="/members/alice.1/">Alice</a> said:</div>
          <div class="bbCodeBlock-content">
            <div class="bbCodeBlock-expandContent">
              <p>Quoted line one</p>
              <p>Quoted line two</p>
            </div>
            <div class="bbCodeBlock-expandLink"><a>Click to expand...</a></div>
          </div>
        </blockquote>
        <p>Reply body</p>
      </div>`;
    const $ = cheerio.load(html);
    const out = normalizeOpHtml($, $('.bbWrapper').first());
    expect(out).toContain('class="x-quote"');
    expect(out).toContain('class="x-quote-title"');
    expect(out).toContain('Alice said:');
    expect(out).toContain('Quoted line one');
    expect(out).toContain('class="x-quote-expand"');
    expect(out).not.toContain('bbCodeBlock');
    expect(out).not.toContain('Click to expand...');
    expect(out).toContain('Reply body');
  });

  it('normalizes nested quotes deepest-first', () => {
    const html = `
      <div class="bbWrapper">
        <blockquote class="bbCodeBlock bbCodeBlock--quote">
          <div class="bbCodeBlock-title">Outer said:</div>
          <div class="bbCodeBlock-content">
            <div class="bbCodeBlock-expandContent">
              <blockquote class="bbCodeBlock bbCodeBlock--quote">
                <div class="bbCodeBlock-title">Inner said:</div>
                <div class="bbCodeBlock-content">
                  <div class="bbCodeBlock-expandContent"><p>Inner text</p></div>
                </div>
              </blockquote>
              <p>Outer text</p>
            </div>
          </div>
        </blockquote>
      </div>`;
    const $ = cheerio.load(html);
    const out = normalizeOpHtml($, $('.bbWrapper').first());
    expect(out.match(/class="x-quote"/g)?.length).toBe(2);
    expect(out).toContain('Inner said:');
    expect(out).toContain('Outer said:');
    expect(out).not.toContain('bbCodeBlock--quote');
  });
});
