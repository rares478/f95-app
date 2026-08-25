import { describe, expect, it } from 'vitest';
import {
  nextStoreCardSlide,
  shouldAdvanceStoreCardSlide,
  storeCardActiveSrc,
} from './storeCardHoverImages';

describe('shouldAdvanceStoreCardSlide', () => {
  it('advances only when hovered with multiple images and motion allowed', () => {
    expect(
      shouldAdvanceStoreCardSlide({
        hovered: true,
        imageCount: 3,
        prefersReducedMotion: false,
      }),
    ).toBe(true);
    expect(
      shouldAdvanceStoreCardSlide({
        hovered: false,
        imageCount: 3,
        prefersReducedMotion: false,
      }),
    ).toBe(false);
    expect(
      shouldAdvanceStoreCardSlide({
        hovered: true,
        imageCount: 1,
        prefersReducedMotion: false,
      }),
    ).toBe(false);
    expect(
      shouldAdvanceStoreCardSlide({
        hovered: true,
        imageCount: 3,
        prefersReducedMotion: true,
      }),
    ).toBe(false);
  });
});

describe('nextStoreCardSlide', () => {
  it('wraps around', () => {
    expect(nextStoreCardSlide(0, 3)).toBe(1);
    expect(nextStoreCardSlide(2, 3)).toBe(0);
    expect(nextStoreCardSlide(0, 0)).toBe(0);
  });
});

describe('storeCardActiveSrc', () => {
  it('returns null for empty list and clamps slide', () => {
    expect(storeCardActiveSrc([], 0)).toBe(null);
    expect(storeCardActiveSrc(['a', 'b'], 99)).toBe('b');
    expect(storeCardActiveSrc(['a', 'b'], 0)).toBe('a');
  });
});
