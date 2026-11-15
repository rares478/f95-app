import { describe, expect, it } from 'vitest';
import {
  repairBrokenChangelogWipHeaders,
  unwrapChangelogSpoilers,
} from './unwrapChangelogSpoilers';

describe('unwrapChangelogSpoilers', () => {
  it('removes summary and unwraps details, keeping inner html', () => {
    const html =
      '<b>v1.0</b><br>' +
      '<details class="x-spoiler"><summary>Spoiler</summary>' +
      '<div class="bbCodeBlock-content">- New scene<br>- Bug fix</div>' +
      '</details>';
    const out = unwrapChangelogSpoilers(html);
    expect(out).toContain('- New scene');
    expect(out).toContain('- Bug fix');
    expect(out.toLowerCase()).not.toContain('<details');
    expect(out.toLowerCase()).not.toContain('<summary');
    expect(out.toLowerCase()).not.toContain('spoiler');
  });

  it('unwraps nested details used to compress older versions', () => {
    const html =
      '<b>v2.0</b><br>- Latest<br>' +
      '<details><summary>Older</summary>' +
      '<b>v1.0</b><br>- Old notes' +
      '</details>';
    const out = unwrapChangelogSpoilers(html);
    expect(out).toContain('<b>v1.0</b>');
    expect(out).toContain('- Old notes');
    expect(out.toLowerCase()).not.toContain('<details');
  });

  it('promotes changelog titles from spoiler summaries into headers', () => {
    const html =
      '<details class="x-spoiler"><summary>Changelog wip.6440</summary>' +
      '<div class="bbCodeBlock-content"><ul><li>Fix</li></ul></div>' +
      '</details>';
    const out = unwrapChangelogSpoilers(html);
    expect(out).toContain('<b>Changelog wip.6440</b>');
    expect(out).toContain('<li>Fix</li>');
    expect(out.toLowerCase()).not.toContain('<details');
    expect(out.toLowerCase()).not.toContain('<summary');
  });
});

describe('repairBrokenChangelogWipHeaders', () => {
  it('stitches Changelog ( closed before the wip token', () => {
    const broken = '<b><u><b><u>Changelog (</u></b>wip.8189):</u></b>';
    expect(repairBrokenChangelogWipHeaders(broken)).toBe(
      '<b><u><b><u>Changelog (wip.8189):</u></b>',
    );
  });
});
