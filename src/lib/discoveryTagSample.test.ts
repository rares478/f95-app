import { describe, expect, it } from 'vitest';
import { TAG_SAMPLE_ROTATE_MS } from './discoveryConfig';
import {
  msUntilNextTagSampleWindow,
  tagSampleSeed,
  tagSampleWindowIndex,
} from './discoveryTagSample';

describe('discoveryTagSample', () => {
  it('windows advance every TAG_SAMPLE_ROTATE_MS', () => {
    const t0 = 1_700_000_000_000;
    expect(tagSampleWindowIndex(t0)).toBe(Math.floor(t0 / TAG_SAMPLE_ROTATE_MS));
    expect(tagSampleWindowIndex(t0 + TAG_SAMPLE_ROTATE_MS)).toBe(
      tagSampleWindowIndex(t0) + 1,
    );
  });

  it('seed is stable inside a window and changes after', () => {
    const day = '2026-08-09';
    // Align to window start: raw 1_700_000_000_000 is mid-window, so
    // t0 + TAG_SAMPLE_ROTATE_MS - 1 would cross the boundary.
    const t0 =
      Math.floor(1_700_000_000_000 / TAG_SAMPLE_ROTATE_MS) * TAG_SAMPLE_ROTATE_MS;
    const a = tagSampleSeed(day, t0);
    const b = tagSampleSeed(day, t0 + TAG_SAMPLE_ROTATE_MS - 1);
    const c = tagSampleSeed(day, t0 + TAG_SAMPLE_ROTATE_MS);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain(day);
  });

  it('msUntilNextTagSampleWindow is in (0, TAG_SAMPLE_ROTATE_MS]', () => {
    const t0 = 1_700_000_000_123;
    const ms = msUntilNextTagSampleWindow(t0);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(TAG_SAMPLE_ROTATE_MS);
  });
});
