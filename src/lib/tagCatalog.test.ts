import { describe, expect, it } from 'vitest';
import { findSamTagByNameOrSlug } from './tagCatalog';

describe('findSamTagByNameOrSlug', () => {
  const catalog = new Map<number, string>([
    [392, 'Female Protagonist'],
    [107, '3dcg'],
    [783, 'Animated'],
  ]);

  it('matches by display name', () => {
    expect(findSamTagByNameOrSlug(catalog, { slug: 'x', name: 'female protagonist' })).toEqual({
      id: 392,
      name: 'Female Protagonist',
    });
  });

  it('matches by slug', () => {
    expect(findSamTagByNameOrSlug(catalog, { slug: '3dcg', name: 'Three D' })).toEqual({
      id: 107,
      name: '3dcg',
    });
  });

  it('returns null when unknown', () => {
    expect(findSamTagByNameOrSlug(catalog, { slug: 'nope', name: 'Nope' })).toBeNull();
  });
});
