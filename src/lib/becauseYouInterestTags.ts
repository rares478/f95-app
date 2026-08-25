export interface ScoredInterestTag {
  tagId: number;
  tagName: string;
  /** Distinct views that contained this tag. */
  viewHits: number;
  score: number;
}

function norm(name: string): string {
  return name.trim().toLowerCase();
}

export function scoreInterestTags(args: {
  viewsTagIds: number[][];
  tagNameById: Map<number, string>;
  denylistNames: Set<string>;
}): ScoredInterestTag[] {
  const deny = new Set([...args.denylistNames].map(norm));
  const hits = new Map<number, number>();
  for (const tags of args.viewsTagIds) {
    const unique = new Set(tags);
    for (const id of unique) {
      hits.set(id, (hits.get(id) ?? 0) + 1);
    }
  }

  const out: ScoredInterestTag[] = [];
  for (const [tagId, viewHits] of hits) {
    const tagName = args.tagNameById.get(tagId);
    if (!tagName || deny.has(norm(tagName))) continue;
    // Intersection bias: square viewHits so multi-view tags dominate single hits.
    const score = viewHits * viewHits;
    out.push({ tagId, tagName, viewHits, score });
  }
  return out.sort((a, b) => b.score - a.score || a.tagName.localeCompare(b.tagName));
}

export function pickInterestReasonTags(
  scored: ScoredInterestTag[],
  limit: number,
): ScoredInterestTag[] {
  if (limit <= 0) return [];
  return scored.slice(0, limit);
}
