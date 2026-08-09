import { describe, expect, it } from 'vitest';
import { buildDiscoveryHomeModel } from './discoveryHomeModel';
import { RAIL_DISPLAY_COUNT, SPOTLIGHT_COUNT, TAG_PANEL_DISPLAY_COUNT } from './discoveryConfig';
import { pickHead, pickSample, buildSpotlight } from './discoverySelection';
import type { DiscoveryPoolRecord } from './discoveryPools';
import type { SamGameCard, SamTag } from '../types/sam';

function card(id: string): SamGameCard {
  return {
    threadId: id,
    title: id,
    version: null,
    thumbnailUrl: null,
    screens: [],
    threadUrl: `https://example.test/${id}`,
    prefixIds: [],
    tagIds: [],
    rating: null,
    views: null,
    likes: null,
    updatedAt: null,
    updatedTs: null,
    creator: null,
    watched: false,
    ignored: false,
    isNew: false,
  };
}

function pool(key: string, ids: string[], fetchedAt = 1): DiscoveryPoolRecord {
  return { key, items: ids.map(card), fetchedAt };
}

const fantasy: SamTag = { id: 42, name: 'Fantasy' };

describe('buildDiscoveryHomeModel', () => {
  it('orders rails recent → likes → views → rating → tags', () => {
    const pools = new Map<string, DiscoveryPoolRecord>([
      ['recent', pool('recent', ['r1', 'r2'])],
      ['likes', pool('likes', ['l1', 'l2'])],
      ['views', pool('views', ['v1', 'v2'])],
      ['rating', pool('rating', ['a1', 'a2'])],
      ['tag:42', pool('tag:42', ['t1', 't2'])],
    ]);

    const model = buildDiscoveryHomeModel({
      pools,
      tagRails: [{ key: 'tag:42', tag: fantasy, name: 'Fantasy' }],
      seed: 'seed-1',
      loadingKeys: new Set(),
      errorKeys: new Map(),
    });

    expect(model.rails.map((r) => r.id)).toEqual([
      'recent',
      'likes',
      'views',
      'rating',
      'tag:42',
    ]);
    expect(model.rails.map((r) => r.poolKey)).toEqual([
      'recent',
      'likes',
      'views',
      'rating',
      'tag:42',
    ]);
  });

  it('uses pickHead for recent and pickSample for other rails', () => {
    const recentIds = Array.from({ length: 20 }, (_, i) => `r${i}`);
    const likesIds = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const pools = new Map<string, DiscoveryPoolRecord>([
      ['recent', pool('recent', recentIds)],
      ['likes', pool('likes', likesIds)],
      ['views', pool('views', [])],
      ['rating', pool('rating', [])],
    ]);
    const seed = 'hour-7';

    const model = buildDiscoveryHomeModel({
      pools,
      tagRails: [],
      seed,
      loadingKeys: new Set(),
      errorKeys: new Map(),
    });

    expect(model.rails[0]!.items.map((c) => c.threadId)).toEqual(
      pickHead(recentIds.map(card), RAIL_DISPLAY_COUNT).map((c) => c.threadId),
    );
    expect(model.rails[1]!.items.map((c) => c.threadId)).toEqual(
      pickSample(likesIds.map(card), RAIL_DISPLAY_COUNT, seed).map((c) => c.threadId),
    );
  });

  it('builds spotlight from recent/likes/views via buildSpotlight', () => {
    const recent = ['r1', 'r2', 'r3'].map(card);
    const likes = ['l1', 'l2', 'l3'].map(card);
    const views = ['v1', 'v2', 'v3'].map(card);
    const seed = 'spot-seed';
    const pools = new Map<string, DiscoveryPoolRecord>([
      ['recent', { key: 'recent', items: recent, fetchedAt: 1 }],
      ['likes', { key: 'likes', items: likes, fetchedAt: 1 }],
      ['views', { key: 'views', items: views, fetchedAt: 1 }],
      ['rating', pool('rating', [])],
    ]);

    const model = buildDiscoveryHomeModel({
      pools,
      tagRails: [],
      seed,
      loadingKeys: new Set(),
      errorKeys: new Map(),
    });

    expect(model.spotlight).toEqual(buildSpotlight(recent, likes, views, SPOTLIGHT_COUNT, seed));
  });

  it('attaches title keys, seeAll handoff, loading, and errors', () => {
    const pools = new Map<string, DiscoveryPoolRecord>([
      ['recent', pool('recent', ['r1'])],
      ['likes', pool('likes', [])],
      ['views', pool('views', [])],
      ['rating', pool('rating', [])],
      ['tag:42', pool('tag:42', ['t1'])],
    ]);

    const model = buildDiscoveryHomeModel({
      pools,
      tagRails: [{ key: 'tag:42', tag: fantasy, name: 'Fantasy' }],
      seed: 's',
      loadingKeys: new Set(['likes']),
      errorKeys: new Map([['views', 'boom']]),
    });

    expect(model.rails[0]).toMatchObject({
      titleKey: 'store.home.rail.recent',
      seeAll: { sort: 'date' },
      loading: false,
      error: null,
    });
    expect(model.rails[1]).toMatchObject({
      titleKey: 'store.home.rail.likes',
      seeAll: { sort: 'likes' },
      loading: true,
      error: null,
    });
    expect(model.rails[2]).toMatchObject({
      titleKey: 'store.home.rail.views',
      seeAll: { sort: 'views' },
      loading: false,
      error: 'boom',
    });
    expect(model.rails[3]).toMatchObject({
      titleKey: 'store.home.rail.rating',
      seeAll: { sort: 'rating' },
    });
    expect(model.rails[4]).toMatchObject({
      titleKey: 'store.home.rail.tag',
      titleParams: { name: 'Fantasy' },
      seeAll: { sort: 'likes', includeTag: fantasy },
    });
  });

  it('tolerates missing pools as empty items', () => {
    const model = buildDiscoveryHomeModel({
      pools: new Map(),
      tagRails: [{ key: 'tag:42', tag: fantasy, name: 'Fantasy' }],
      seed: 's',
      loadingKeys: new Set(['recent', 'tag:42']),
      errorKeys: new Map(),
    });

    expect(model.spotlight).toEqual([]);
    expect(model.rails).toHaveLength(5);
    expect(model.rails.every((r) => r.items.length === 0)).toBe(true);
    expect(model.rails[0]!.loading).toBe(true);
    expect(model.rails[4]!.loading).toBe(true);
  });

  it('prepends user rails before global rails and omits empty non-loading user rails', () => {
    const pools = new Map<string, DiscoveryPoolRecord>([
      ['recent', pool('recent', ['r1'])],
      ['likes', pool('likes', [])],
      ['views', pool('views', [])],
      ['rating', pool('rating', [])],
    ]);

    const model = buildDiscoveryHomeModel({
      pools,
      tagRails: [],
      seed: 's',
      loadingKeys: new Set(),
      errorKeys: new Map(),
      userRails: [
        {
          id: 'recently-viewed',
          poolKey: 'recently-viewed',
          titleKey: 'store.home.rail.recentlyViewed',
          items: [card('v1')],
          loading: false,
          error: null,
          seeAll: {},
        },
        {
          id: 'because-you-play',
          poolKey: 'because-you-play',
          titleKey: 'store.home.rail.becauseYouPlay',
          titleParams: { title: 'Seed' },
          items: [],
          loading: false,
          error: null,
          seeAll: {},
        },
      ],
    });

    expect(model.rails.map((r) => r.id)).toEqual([
      'recently-viewed',
      'recent',
      'likes',
      'views',
      'rating',
    ]);
  });

  it('excludes ignored cards from spotlight, sort rails, and user rails', () => {
    const ignored = { ...card('bad'), ignored: true };
    const pools = new Map<string, DiscoveryPoolRecord>([
      ['recent', { key: 'recent', items: [ignored, card('r1')], fetchedAt: 1 }],
      ['likes', { key: 'likes', items: [ignored, card('l1')], fetchedAt: 1 }],
      ['views', { key: 'views', items: [card('v1')], fetchedAt: 1 }],
      ['rating', { key: 'rating', items: [card('a1')], fetchedAt: 1 }],
    ]);

    const model = buildDiscoveryHomeModel({
      pools,
      tagRails: [],
      seed: 'seed-1',
      loadingKeys: new Set(),
      errorKeys: new Map(),
      userRails: [
        {
          id: 'because-you-play',
          poolKey: 'because-you-play',
          titleKey: 'store.home.rail.becauseYouPlay',
          titleParams: { title: 'X' },
          items: [ignored, card('ok')],
          loading: false,
          error: null,
          seeAll: {},
        },
      ],
    });

    const allIds = [
      ...model.spotlight.map((c) => c.threadId),
      ...model.rails.flatMap((r) => r.items.map((c) => c.threadId)),
    ];
    expect(allIds).not.toContain('bad');
    expect(model.rails.find((r) => r.id === 'because-you-play')?.items.map((c) => c.threadId)).toEqual([
      'ok',
    ]);
  });

  it('samples tag rails with tagSeed and TAG_PANEL_DISPLAY_COUNT', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const pools = new Map<string, DiscoveryPoolRecord>([
      ['recent', pool('recent', [])],
      ['likes', pool('likes', [])],
      ['views', pool('views', [])],
      ['rating', pool('rating', [])],
      ['tag:42', pool('tag:42', ids)],
    ]);
    const seed = 'hour-seed';
    const tagSeed = 'day:tag:1';

    const model = buildDiscoveryHomeModel({
      pools,
      tagRails: [{ key: 'tag:42', tag: fantasy, name: 'Fantasy' }],
      seed,
      tagSeed,
      loadingKeys: new Set(),
      errorKeys: new Map(),
    });

    const tagRail = model.rails.find((r) => r.id === 'tag:42')!;
    expect(tagRail.items).toHaveLength(TAG_PANEL_DISPLAY_COUNT);
    expect(tagRail.items.map((c) => c.threadId)).toEqual(
      pickSample(ids.map(card), TAG_PANEL_DISPLAY_COUNT, tagSeed).map((c) => c.threadId),
    );
    expect(tagRail.items.map((c) => c.threadId)).not.toEqual(
      pickSample(ids.map(card), TAG_PANEL_DISPLAY_COUNT, seed).map((c) => c.threadId),
    );
  });
});
