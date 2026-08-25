import { describe, expect, it } from 'vitest';
import { pickInterestReasonTags, scoreInterestTags } from './becauseYouInterestTags';

describe('scoreInterestTags', () => {
  it('scores higher when a tag appears across more distinct views', () => {
    const scored = scoreInterestTags({
      viewsTagIds: [
        [1, 10, 20],
        [1, 11],
        [1, 12],
      ],
      denylistNames: new Set(['male protagonist']),
      tagNameById: new Map([
        [1, 'Corruption'],
        [10, 'Male protagonist'],
        [11, 'Romance'],
        [12, 'Fantasy'],
        [20, 'NTR'],
      ]),
    });
    expect(scored[0]?.tagId).toBe(1);
    expect(scored.find((s) => s.tagId === 10)).toBeUndefined();
  });

  it('never returns denylisted tags from pickInterestReasonTags', () => {
    const scored = scoreInterestTags({
      viewsTagIds: [[10], [10], [11]],
      denylistNames: new Set(['male protagonist']),
      tagNameById: new Map([
        [10, 'Male protagonist'],
        [11, 'Romance'],
      ]),
    });
    const picked = pickInterestReasonTags(scored, 3);
    expect(picked.every((p) => p.tagId !== 10)).toBe(true);
    expect(picked[0]?.tagId).toBe(11);
  });
});
