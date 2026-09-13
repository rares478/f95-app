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
});
