import { describe, expect, it } from 'vitest';
import {
  buildBecauseYouFingerprint,
  mixBecauseYouSlots,
  shouldRebuildBecauseYouPack,
} from './becauseYouPack';
import type { BecauseYouCardModel } from '../types/becauseYou';
import type { SamGameCard } from '../types/sam';

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

describe('shouldRebuildBecauseYouPack', () => {
  it('keeps cache on same day even if fingerprint changed', () => {
    expect(
      shouldRebuildBecauseYouPack({
        cachedDayKey: '2026-08-25',
        todayKey: '2026-08-25',
        cachedFingerprint: 'old',
        currentFingerprint: 'new',
      }),
    ).toBe(false);
  });

  it('rebuilds when day changes', () => {
    expect(
      shouldRebuildBecauseYouPack({
        cachedDayKey: '2026-08-24',
        todayKey: '2026-08-25',
        cachedFingerprint: 'a',
        currentFingerprint: 'a',
      }),
    ).toBe(true);
  });
});

describe('mixBecauseYouSlots', () => {
  it('mixes play and interest up to 3 with no duplicate games', () => {
    const play: BecauseYouCardModel[] = [
      { game: card('p1'), reason: { kind: 'play', seedThreadId: 's1', seedTitle: 'Seed1' } },
      { game: card('p2'), reason: { kind: 'play', seedThreadId: 's2', seedTitle: 'Seed2' } },
      { game: card('p3'), reason: { kind: 'play', seedThreadId: 's3', seedTitle: 'Seed3' } },
    ];
    const interest: BecauseYouCardModel[] = [
      { game: card('i1'), reason: { kind: 'interest', tagId: 1, tagName: 'Romance' } },
      { game: card('p1'), reason: { kind: 'interest', tagId: 2, tagName: 'Fantasy' } },
      { game: card('i2'), reason: { kind: 'interest', tagId: 3, tagName: 'NTR' } },
    ];
    const mixed = mixBecauseYouSlots({ play, interest, maxCards: 3, maxPlay: 2, maxInterest: 2 });
    expect(mixed).toHaveLength(3);
    expect(mixed.filter((c) => c.reason.kind === 'play').length).toBeGreaterThanOrEqual(1);
    expect(mixed.filter((c) => c.reason.kind === 'interest').length).toBeGreaterThanOrEqual(1);
    expect(new Set(mixed.map((c) => c.game.threadId)).size).toBe(3);
  });
});

describe('buildBecauseYouFingerprint', () => {
  it('joins play seed fingerprint and view ids', () => {
    expect(
      buildBecauseYouFingerprint({
        playFingerprint: '1@t',
        viewThreadIds: ['a', 'b'],
      }),
    ).toBe('play:1@t|views:a,b');
  });
});
