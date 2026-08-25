import { describe, expect, it } from 'vitest';
import { groupHomeBands } from './discoveryHomeBands';
import type { SamGameCard } from '../types/sam';

function rail(id: string, items: SamGameCard[] = []): Parameters<typeof groupHomeBands>[0][number] {
  return {
    id,
    titleKey: `k.${id}`,
    items,
    loading: false,
    error: null,
    seeAll: {},
  };
}

describe('groupHomeBands', () => {
  it('groups in hybrid Home order', () => {
    const bands = groupHomeBands([
      rail('recently-viewed'),
      rail('because-you-play'),
      rail('recent'),
      rail('likes'),
      rail('views'),
      rail('rating'),
      rail('tag:1'),
      rail('tag:2'),
    ]);
    expect(bands.map((b) => b.type)).toEqual(['recent', 'popular', 'tags']);
    if (bands[1]?.type === 'popular') {
      expect(bands[1].tabs.map((r) => r.id)).toEqual(['likes', 'views', 'rating']);
    }
    if (bands[2]?.type === 'tags') {
      expect(bands[2].panels.map((r) => r.id)).toEqual(['tag:1', 'tag:2']);
    }
  });

  it('ignores legacy forYou rail ids', () => {
    const bands = groupHomeBands([
      rail('recently-viewed'),
      rail('because-you-play'),
      rail('recent'),
    ]);
    expect(bands.map((b) => b.type)).toEqual(['recent']);
  });

  it('omits missing sections', () => {
    const bands = groupHomeBands([rail('likes'), rail('tag:9')]);
    expect(bands.map((b) => b.type)).toEqual(['popular', 'tags']);
  });
});
