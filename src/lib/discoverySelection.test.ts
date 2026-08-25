import { describe, expect, it } from 'vitest';
import {
  buildSpotlight,
  dedupeByThreadId,
  isPoolFresh,
  pickHead,
  pickSample,
  pickSampleExcluding,
  withoutIgnored,
} from './discoverySelection';
import type { SamGameCard } from '../types/sam';

function card(id: string, title = id): SamGameCard {
  return {
    threadId: id,
    title,
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

describe('isPoolFresh', () => {
  it('is fresh inside TTL and stale after', () => {
    expect(isPoolFresh(1000, 3600_000, 1000 + 3599_000)).toBe(true);
    expect(isPoolFresh(1000, 3600_000, 1000 + 3600_001)).toBe(false);
  });
});

describe('dedupeByThreadId', () => {
  it('keeps first occurrence', () => {
    const out = dedupeByThreadId([card('1', 'a'), card('1', 'b'), card('2')]);
    expect(out.map((c) => c.title)).toEqual(['a', '2']);
  });
});

describe('pickHead / pickSample / buildSpotlight', () => {
  it('pickHead returns first n', () => {
    expect(pickHead([card('1'), card('2'), card('3')], 2).map((c) => c.threadId)).toEqual([
      '1',
      '2',
    ]);
  });

  it('pickSample is deterministic for a seed', () => {
    const pool = Array.from({ length: 20 }, (_, i) => card(String(i)));
    const a = pickSample(pool, 5, 'hour-1').map((c) => c.threadId);
    const b = pickSample(pool, 5, 'hour-1').map((c) => c.threadId);
    const c = pickSample(pool, 5, 'hour-2').map((c) => c.threadId);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('pickSampleExcluding skips claimed ids and fills from the rest', () => {
    const pool = Array.from({ length: 10 }, (_, i) => card(String(i)));
    const first = pickSample(pool, 4, 'seed');
    const claimed = new Set(first.map((c) => c.threadId));
    const second = pickSampleExcluding(pool, 4, 'seed', claimed);
    expect(second).toHaveLength(4);
    expect(second.every((c) => !claimed.has(c.threadId))).toBe(true);
    expect(new Set([...first, ...second].map((c) => c.threadId)).size).toBe(8);
  });

  it('buildSpotlight mixes sources and dedupes to count', () => {
    const recent = [card('r1'), card('r2'), card('shared')];
    const likes = [card('shared'), card('l1'), card('l2')];
    const views = [card('v1'), card('v2')];
    const slides = buildSpotlight(recent, likes, views, 5, 'seed');
    expect(slides).toHaveLength(5);
    expect(new Set(slides.map((s) => s.threadId)).size).toBe(5);
  });
});

describe('withoutIgnored', () => {
  it('drops ignored cards and keeps others', () => {
    const keep = card('1');
    const drop = { ...card('2'), ignored: true };
    expect(withoutIgnored([keep, drop]).map((c) => c.threadId)).toEqual(['1']);
  });

  it('returns empty when all ignored', () => {
    expect(withoutIgnored([{ ...card('9'), ignored: true }])).toEqual([]);
  });
});
