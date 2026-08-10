import { describe, expect, it } from 'vitest';
import { pathForForumSearchHit, samCategoryForForum } from './catalogForums';

describe('samCategoryForForum', () => {
  it('maps catalog forums', () => {
    expect(samCategoryForForum('Games')).toBe('games');
    expect(samCategoryForForum(' mods ')).toBe('mods');
    expect(samCategoryForForum('Animations & Loops')).toBe('animations');
    expect(samCategoryForForum('Comics & Stills')).toBe('comics');
    expect(samCategoryForForum('Asset Releases')).toBe('assets');
  });

  it('returns null for non-catalog forums', () => {
    expect(samCategoryForForum('Requests')).toBeNull();
    expect(samCategoryForForum('')).toBeNull();
  });
});

describe('pathForForumSearchHit', () => {
  it('routes catalog hits to game detail with cat', () => {
    expect(pathForForumSearchHit({ threadId: '1', forum: 'Games' })).toBe(
      '/store/game/1?cat=games',
    );
    expect(pathForForumSearchHit({ threadId: '2', forum: 'Asset Releases' })).toBe(
      '/store/game/2?cat=assets',
    );
  });

  it('routes other forums to thread page', () => {
    expect(pathForForumSearchHit({ threadId: '9', forum: 'Requests' })).toBe(
      '/thread/9',
    );
  });
});
