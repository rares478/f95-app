import { describe, expect, it } from 'vitest';
import { buildStoreTagsFromDetail } from './storeTagsFromDetail';
import type { GameDetail } from '../types/game';

function detail(over: Partial<GameDetail> = {}): GameDetail {
  return {
    threadId: '1',
    threadUrl: 'https://f95zone.to/threads/1',
    title: 'T',
    rawTitle: 'T',
    version: '1.0',
    developer: null,
    author: null,
    authorUserId: null,
    authorAvatarUrl: null,
    bannerUrl: null,
    screenshots: [],
    descriptionHtml: '',
    prefixes: [],
    fields: {},
    tags: [],
    downloads: [],
    social: [],
    ...over,
  };
}

describe('buildStoreTagsFromDetail', () => {
  it('returns empty array when no tags or engine prefixes', () => {
    expect(buildStoreTagsFromDetail(detail())).toEqual([]);
  });

  it('collects trimmed tag names in order', () => {
    expect(
      buildStoreTagsFromDetail(
        detail({
          tags: [
            { slug: 'adventure', name: 'Adventure' },
            { slug: 'x', name: '  ' },
            { slug: 'male', name: 'Male protagonist' },
          ],
        }),
      ),
    ).toEqual(['Adventure', 'Male protagonist']);
  });

  it('adds known prefix names when not already tagged', () => {
    expect(
      buildStoreTagsFromDetail(
        detail({
          tags: [{ slug: 'adventure', name: 'Adventure' }],
          prefixes: [
            { name: "Ren'Py", cssClass: null },
            { name: 'Completed', cssClass: null },
            { name: 'VN', cssClass: null },
          ],
        }),
      ),
    ).toEqual(['Adventure', "Ren'Py", 'Completed', 'VN']);
  });

  it('dedupes engine against existing tags case-insensitively', () => {
    expect(
      buildStoreTagsFromDetail(
        detail({
          tags: [{ slug: 'renpy', name: "ren'py" }],
          prefixes: [{ name: "Ren'Py", cssClass: null }],
        }),
      ),
    ).toEqual(["ren'py"]);
  });

  it('matches engine prefixes case-insensitively by catalog name', () => {
    expect(
      buildStoreTagsFromDetail(
        detail({
          prefixes: [{ name: 'unity', cssClass: null }],
        }),
      ),
    ).toEqual(['Unity']);
  });
});
