import { describe, expect, it } from 'vitest';
import {
  isSearchFiltersDirty,
  shouldApplySearchResult,
  type ForumSearchFilterSnapshot,
} from './forumSearchUi';

const base: ForumSearchFilterSnapshot = {
  titleOnly: false,
  searchIn: 'posts',
  sort: 'relevance',
};

describe('shouldApplySearchResult', () => {
  it('applies only the latest generation', () => {
    expect(shouldApplySearchResult(3, 3)).toBe(true);
    expect(shouldApplySearchResult(2, 3)).toBe(false);
  });
});

describe('isSearchFiltersDirty', () => {
  it('is clean when there is no active snapshot', () => {
    expect(isSearchFiltersDirty(base, null)).toBe(false);
  });

  it('is clean when live matches active', () => {
    expect(isSearchFiltersDirty(base, { ...base })).toBe(false);
  });

  it('detects dirty titleOnly / searchIn / sort', () => {
    expect(isSearchFiltersDirty({ ...base, titleOnly: true }, base)).toBe(true);
    expect(isSearchFiltersDirty({ ...base, searchIn: 'titles' }, base)).toBe(true);
    expect(isSearchFiltersDirty({ ...base, sort: 'date' }, base)).toBe(true);
  });
});
