import { describe, expect, it } from 'vitest';
import { buildBrowseHandoff } from './browseHandoff';

describe('buildBrowseHandoff', () => {
  it('seeds sort for See all liked', () => {
    expect(buildBrowseHandoff({ sort: 'likes' })).toEqual({
      category: 'games',
      sort: 'likes',
      search: '',
      includeTags: [],
    });
  });

  it('seeds search', () => {
    expect(buildBrowseHandoff({ search: 'foo' }).search).toBe('foo');
  });

  it('seeds tag + sort', () => {
    const tag = { id: 1, name: 'Fantasy' };
    expect(buildBrowseHandoff({ includeTag: tag, sort: 'likes' })).toMatchObject({
      includeTags: [tag],
      sort: 'likes',
    });
  });
});
