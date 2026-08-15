import { describe, expect, it } from 'vitest';
import {
  storeGameImageUrl,
  storeGameThumbUrls,
  toF95FullUrl,
  toF95ThumbUrl,
} from './f95ImageUrl';

const FULL =
  'https://attachments.f95zone.to/2024/01/abc123_cover.jpg';
const THUMB =
  'https://attachments.f95zone.to/2024/01/thumb/abc123_cover.jpg';
const PREVIEW =
  'https://preview.f95zone.to/2024/01/abc123_cover.jpg';
const SCREEN_PREVIEW =
  'https://preview.f95zone.to/2024/01/screen1.jpg';
const SCREEN_FULL =
  'https://attachments.f95zone.to/2024/01/screen1.jpg';

describe('toF95FullUrl / toF95ThumbUrl', () => {
  it('strips /thumb/ before the filename', () => {
    expect(toF95FullUrl(THUMB)).toBe(FULL);
  });

  it('rewrites preview CDN to attachments for full resolution', () => {
    expect(toF95FullUrl(PREVIEW)).toBe(FULL);
    expect(toF95FullUrl(SCREEN_PREVIEW)).toBe(SCREEN_FULL);
  });

  it('maps attachments to preview CDN for thumbs', () => {
    expect(toF95ThumbUrl(FULL)).toBe(PREVIEW);
    expect(toF95ThumbUrl(SCREEN_FULL)).toBe(SCREEN_PREVIEW);
  });
});

describe('storeGameImageUrl', () => {
  it('prefers first screen at full (attachments) resolution', () => {
    expect(
      storeGameImageUrl(
        { thumbnailUrl: PREVIEW, screens: [SCREEN_PREVIEW] },
        'full',
      ),
    ).toBe(SCREEN_FULL);
  });

  it('falls back to cover full when screens are empty', () => {
    expect(
      storeGameImageUrl({ thumbnailUrl: PREVIEW, screens: [] }, 'full'),
    ).toBe(FULL);
  });

  it('uses SAM cover as-is for thumbs', () => {
    expect(
      storeGameImageUrl(
        { thumbnailUrl: PREVIEW, screens: [SCREEN_PREVIEW] },
        'thumb',
      ),
    ).toBe(PREVIEW);
  });

  it('falls back to screen preview when cover is missing', () => {
    expect(
      storeGameImageUrl({ thumbnailUrl: null, screens: [SCREEN_FULL] }, 'thumb'),
    ).toBe(SCREEN_PREVIEW);
  });
});

describe('storeGameThumbUrls', () => {
  it('keeps cover as-is and previews screenshots', () => {
    expect(
      storeGameThumbUrls({
        thumbnailUrl: PREVIEW,
        screens: [SCREEN_FULL],
      }),
    ).toEqual([PREVIEW, SCREEN_PREVIEW]);
  });
});
