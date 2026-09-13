import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseChangelogHtml } from './parseChangelogHtml';

const dir = dirname(fileURLToPath(import.meta.url));
const load = (name: string) =>
  readFileSync(join(dir, '__fixtures__', name), 'utf8');

describe('parseChangelogHtml', () => {
  it('splits Summer Heat into multiple version entries', () => {
    const r = parseChangelogHtml(load('summer-heat.html'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.length).toBeGreaterThanOrEqual(5);
    expect(r.entries[0].title.toLowerCase()).toContain('0.6.1');
    expect(r.entries.some((e) => /0\.2\.2/i.test(e.title))).toBe(true);
    // Outer bbCode wrapper alone must not become a visible preamble
    expect(r.preambleHtml.trim()).toBe('');
  });

  it('handles Living with Vicky preamble and V 0.1', () => {
    const r = parseChangelogHtml(load('living-with-vicky.html'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preambleHtml.toLowerCase()).toContain('no changelogs');
    expect(r.entries.some((e) => /0\.1/i.test(e.title))).toBe(true);
  });

  it('handles Harmony Haven chapter titles', () => {
    const r = parseChangelogHtml(load('harmony-haven.html'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries[0].title).toMatch(/Chapter 5/i);
  });

  it('handles Taffy date and season headers', () => {
    const r = parseChangelogHtml(load('taffy-tales.html'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.some((e) => e.title.includes('2026-05-28'))).toBe(true);
    expect(r.entries.some((e) => /1\.07\.3c/i.test(e.title))).toBe(true);
  });

  it('handles DeLuca mixed bold/plain version lines', () => {
    const r = parseChangelogHtml(load('deluca-family.html'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.length).toBeGreaterThanOrEqual(5);
    expect(r.entries.some((e) => /0\.09\.5/i.test(e.title))).toBe(true);
    // Unprefixed dotted versions must still split as headers
    expect(r.entries.some((e) => /^0\.06\.6$/i.test(e.title.trim()))).toBe(true);
    expect(r.entries.some((e) => /^0\.06\.5$/i.test(e.title.trim()))).toBe(true);
    // Bold mid-header "Bug Fixes" must NOT become its own entry
    expect(r.entries.every((e) => !/^bug fixes$/i.test(e.title.trim()))).toBe(
      true,
    );
  });

  it('returns ok:false when fewer than 2 headers', () => {
    expect(parseChangelogHtml('<div>Just some notes without versions</div>')).toEqual({
      ok: false,
    });
  });

  it('peels Final soft header and versions glued after </details>', () => {
    const html = [
      '<div class="bbCodeBlock-content"><b>Final</b><br>',
      '- Ending scene<br>',
      '<b>v2.65</b><br>',
      '- New scene<br>',
      '<details class="x-spoiler"><summary>Spoiler</summary>',
      '<div class="bbCodeBlock-content">- Hidden</div>',
      '</div></details>v2.60<br>',
      '- Evelyn scene<br>',
      '</details>v2.55<br>',
      '- Potion scenes',
    ].join('');
    const r = parseChangelogHtml(html);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const titles = r.entries.map((e) => e.title);
    expect(titles[0]).toBe('Final');
    expect(titles).toContain('v2.65');
    expect(titles).toContain('v2.60');
    expect(titles).toContain('v2.55');
    expect(r.preambleHtml.trim()).toBe('');
  });

  it('splits Summertime-style Changelog (wip.N) bold headers', () => {
    const html = [
      '<div class="bbCodeBlock-content"><b><u>Changelog (wip.7944):</u></b><br>',
      '<ul><li>New Maria event</li></ul>',
      '<b><u>Changelog (wip.7712):</u></b><br>',
      '<ul><li>Resumed main story</li></ul>',
      '<b>v0.20.15 (Pre-tech - Part 5):</b><br>',
      '- Older notes',
    ].join('');
    const r = parseChangelogHtml(html);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const titles = r.entries.map((e) => e.title);
    expect(titles[0]).toMatch(/wip\.7944/i);
    expect(titles.some((t) => /wip\.7712/i.test(t))).toBe(true);
    expect(titles.some((t) => /0\.20\.15/i.test(t))).toBe(true);
    expect(r.preambleHtml.trim()).toBe('');
  });

  it('splits slash dates and Demo labels; ignores version-like body lines', () => {
    const html = [
      '<div class="bbCodeBlock-content"><b>26/06/2024</b><br>',
      'First version of DLC Translation release!<br>',
      '<b>03/04/2024</b><br>',
      'Steam Version updated to 1.04<br>',
      '<b>2024-03-23</b><br>',
      'Steam version added<br>',
      '<b>v1.4.3 Translation φ</b><br>',
      'Updated To Imouto Fantasy 1.4.3!<br>',
      'V0.2 translation transferred<br>',
      '<b>Demo Translation V0.1</b><br>',
      'Initial Release!',
    ].join('');
    const r = parseChangelogHtml(html);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const titles = r.entries.map((e) => e.title);
    expect(titles[0]).toBe('26/06/2024');
    expect(titles).toContain('03/04/2024');
    expect(titles).toContain('2024-03-23');
    expect(titles).toContain('v1.4.3 Translation φ');
    expect(titles).toContain('Demo Translation V0.1');
    expect(titles.every((t) => !/translation transferred/i.test(t))).toBe(true);
    expect(r.preambleHtml.trim()).toBe('');
  });

  it('surfaces version headers that were compressed inside spoilers', () => {
    const html = [
      '<b>v2.0</b><br>- Latest notes<br>',
      '<details class="x-spoiler"><summary>Spoiler</summary>',
      '<b>v1.5</b><br>- Mid notes<br>',
      '<b>v1.0</b><br>- Old notes',
      '</details>',
    ].join('');
    const r = parseChangelogHtml(html);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const titles = r.entries.map((e) => e.title);
    expect(titles).toEqual(['v2.0', 'v1.5', 'v1.0']);
    expect(r.entries[1].bodyHtml).toContain('Mid notes');
    expect(r.entries.every((e) => !/<details/i.test(e.bodyHtml))).toBe(true);
  });

  it('strips trailing br + CRLF padding between version entries', () => {
    const html =
      '<b>v0.6.1</b><br>\r\nBugfix<br>\r\n<br>\r\n' +
      '<b>v0.6</b><br>\r\n- 1800 new renders<br>\r\n<br>\r\n' +
      '<b>v0.5</b><br>\r\n- Older notes\r\n';
    const r = parseChangelogHtml(html);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries[0].bodyHtml).toBe('Bugfix');
    expect(r.entries[1].bodyHtml).toBe('- 1800 new renders');
    expect(r.entries[2].bodyHtml).toBe('- Older notes');
  });

  it('splits Wicked Choices Vdd/mm/yy and Remaster headers', () => {
    const html = [
      '<div class="bbCodeBlock-content">Remastered v1.0.1 - 2024-01-25<br>',
      'N/A<br>',
      'Remaster v1.0.1<br>',
      'Fix for rare visual bug<br>',
      'V06/12/18 (Mac &amp; Android v1.1)<br>',
      '<ul><li>Android fix</li></ul>',
      '<b>V15/10/18 (0.6.1.0)</b><br>',
      'Added Chapter Six<br>',
      '<b>v16/09/17:</b><br>',
      'Prologue released.',
    ].join('');
    const r = parseChangelogHtml(html);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const titles = r.entries.map((e) => e.title);
    expect(titles[0]).toMatch(/Remastered v1\.0\.1/i);
    expect(titles.some((t) => /Remaster v1\.0\.1/i.test(t))).toBe(true);
    expect(titles.some((t) => /V06\/12\/18.*Android/i.test(t))).toBe(true);
    expect(titles.some((t) => t.includes('&amp;'))).toBe(false);
    expect(titles.some((t) => /V15\/10\/18/i.test(t))).toBe(true);
    expect(titles.some((t) => /v16\/09\/17/i.test(t))).toBe(true);
  });

  it('splits bold chapter labels without a version core', () => {
    const html = [
      '<div class="bbCodeBlock-content"><b>Chapter 4</b><br>',
      'Achievements and bug fixes.<br>',
      '<b>Chapter 4 Beta</b><br>',
      '<ul><li>16 scenes</li></ul>',
      '<b>Chapter 3</b><br>',
      'Walkthrough DLC added<br>',
      '<b>Chapter 3 (V0.25)</b><br>',
      '- 13 scenes<br>',
      '<b>v0.1.1</b><br>',
      'Cursor fix',
    ].join('');
    const r = parseChangelogHtml(html);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const titles = r.entries.map((e) => e.title);
    expect(titles[0]).toBe('Chapter 4');
    expect(titles).toContain('Chapter 4 Beta');
    expect(titles).toContain('Chapter 3');
    expect(titles).toContain('Chapter 3 (V0.25)');
    expect(titles).toContain('v0.1.1');
    expect(r.preambleHtml.trim()).toBe('');
  });
});
