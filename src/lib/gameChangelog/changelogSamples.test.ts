import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseChangelogHtml } from './parseChangelogHtml';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const samplesDir = join(repoRoot, 'local/changelog-samples');
const hasSamples = existsSync(samplesDir);

const sampleFiles = hasSamples
  ? readdirSync(samplesDir)
      .filter((name) => name.toLowerCase().endsWith('.txt'))
      .sort()
  : [];

describe.skipIf(!hasSamples)('local/changelog-samples', () => {
  it('finds at least one sample', () => {
    expect(sampleFiles.length).toBeGreaterThan(0);
  });

  it.each(sampleFiles)('parses %s into version entries', (name) => {
    const html = readFileSync(join(samplesDir, name), 'utf8');
    const result = parseChangelogHtml(html);
    expect(result.ok, `${name} should parse`).toBe(true);
    if (!result.ok) return;
    expect(result.entries.length, `${name} entry count`).toBeGreaterThanOrEqual(
      2,
    );
    expect(
      result.entries.every((e) => e.title.trim().length > 0),
      `${name} titles`,
    ).toBe(true);
  });
});
