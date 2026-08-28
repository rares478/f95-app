import { describe, expect, it } from 'vitest';
import {
  forumSearchToSearchParams,
  isSearchFiltersDirty,
  parseForumSearchSearchParams,
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

describe('parseForumSearchSearchParams / forumSearchToSearchParams', () => {
  it('returns null without q', () => {
    expect(parseForumSearchSearchParams(new URLSearchParams())).toBeNull();
    expect(parseForumSearchSearchParams(new URLSearchParams('title_only=1'))).toBeNull();
  });

  it('parses q and defaults', () => {
    expect(parseForumSearchSearchParams(new URLSearchParams('q=love'))).toEqual({
      query: 'love',
      titleOnly: false,
      searchIn: 'posts',
      sort: 'relevance',
      page: 1,
    });
  });

  it('parses non-default filters and page', () => {
    const params = new URLSearchParams(
      'q=f95+app&title_only=1&search_in=titles&sort=date&page=3',
    );
    expect(parseForumSearchSearchParams(params)).toEqual({
      query: 'f95 app',
      titleOnly: true,
      searchIn: 'titles',
      sort: 'date',
      page: 3,
    });
  });

  it('round-trips non-default state', () => {
    const state = {
      query: 'f95 app',
      titleOnly: true,
      searchIn: 'titles' as const,
      sort: 'date' as const,
      page: 2,
    };
    const parsed = parseForumSearchSearchParams(forumSearchToSearchParams(state));
    expect(parsed).toEqual(state);
  });

  it('omits default filter params', () => {
    const params = forumSearchToSearchParams({
      query: 'x',
      titleOnly: false,
      searchIn: 'posts',
      sort: 'relevance',
      page: 1,
    });
    expect(params.toString()).toBe('q=x');
  });

  it('parses thread scope param', () => {
    expect(parseForumSearchSearchParams(new URLSearchParams('q=x&thread=25332'))).toEqual({
      query: 'x',
      titleOnly: false,
      searchIn: 'posts',
      sort: 'relevance',
      page: 1,
      threadId: '25332',
    });
  });

  it('ignores invalid thread param', () => {
    const parsed = parseForumSearchSearchParams(new URLSearchParams('q=x&thread=abc'));
    expect(parsed?.threadId).toBeUndefined();
  });

  it('serializes threadId', () => {
    const params = forumSearchToSearchParams({
      query: 'x',
      titleOnly: false,
      searchIn: 'posts',
      sort: 'relevance',
      page: 1,
      threadId: '25332',
    });
    expect(params.get('thread')).toBe('25332');
  });
});

describe('isSearchFiltersDirty threadId', () => {
  it('detects dirty threadId', () => {
    expect(
      isSearchFiltersDirty({ ...base, threadId: '1' }, { ...base, threadId: '2' }),
    ).toBe(true);
  });
});
