import { describe, expect, it } from 'vitest';
import { clampGalleryIndex } from './screenshotGalleryIndex';

describe('clampGalleryIndex', () => {
  it('returns 0 for empty galleries', () => {
    expect(clampGalleryIndex(3, 0)).toBe(0);
    expect(clampGalleryIndex(-1, 0)).toBe(0);
  });

  it('clamps to valid range', () => {
    expect(clampGalleryIndex(-1, 4)).toBe(0);
    expect(clampGalleryIndex(0, 4)).toBe(0);
    expect(clampGalleryIndex(3, 4)).toBe(3);
    expect(clampGalleryIndex(99, 4)).toBe(3);
  });
});
