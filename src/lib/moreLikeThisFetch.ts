import { samList } from './ipc';
import type { SamCategory, SamGameCard, SamSort } from '../types/sam';

/** AND this many tags per query — tighter than OR of common tags. */
const TAGS_PER_QUERY = 3;
const PARALLEL_QUERIES = 3;
const ROWS_PER_QUERY = 20;
/** Sample from the first N SAM pages so results are not stuck on page 1. */
const MAX_PAGE_JITTER = 8;
const DEFAULT_LIMIT = 12;

const QUERY_SORTS: SamSort[] = ['date', 'rating', 'likes'];

function pickRandom<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, max);
}

function randomPage(totalPages: number): number {
  const max = Math.min(Math.max(1, totalPages), MAX_PAGE_JITTER);
  return 1 + Math.floor(Math.random() * max);
}

/**
 * Similar games via several random AND tag queries.
 * Avoids likes+OR+page1, which always returned the same mega-popular titles.
 */
export async function fetchMoreLikeThis(args: {
  category: SamCategory;
  excludeThreadIds: string[];
  tagIds: number[];
  limit?: number;
}): Promise<SamGameCard[]> {
  const { category, excludeThreadIds, tagIds, limit = DEFAULT_LIMIT } = args;
  if (tagIds.length === 0) return [];

  const tagCount = Math.min(TAGS_PER_QUERY, tagIds.length);
  const queryCount = tagIds.length <= 1 ? 1 : PARALLEL_QUERIES;
  const batches = Array.from({ length: queryCount }, (_, i) => ({
    tags: pickRandom(tagIds, tagCount),
    sort: QUERY_SORTS[i % QUERY_SORTS.length]!,
  }));

  const pools = await Promise.all(
    batches.map(async ({ tags, sort }) => {
      const base = {
        category,
        tags,
        tagtype: tags.length > 1 ? ('and' as const) : undefined,
        sort,
        rows: ROWS_PER_QUERY,
      };
      const first = await samList({ ...base, page: 1 });
      const items = [...first.items];

      const page = randomPage(first.totalPages);
      if (page > 1) {
        const deeper = await samList({ ...base, page });
        items.push(...deeper.items);
      }

      // AND of rare tags can be sparse — loosen once so the rail is not blank.
      if (items.length < 4 && tags.length > 1) {
        const loose = await samList({
          ...base,
          tagtype: 'or',
          sort: 'date',
          page: randomPage(Math.max(first.totalPages, 1)),
        });
        items.push(...loose.items);
      }

      return items;
    }),
  );

  const exclude = new Set<string>(excludeThreadIds);
  const out: SamGameCard[] = [];
  for (const items of pools) {
    for (const g of items) {
      if (exclude.has(g.threadId)) continue;
      exclude.add(g.threadId);
      out.push(g);
    }
  }

  return pickRandom(out, limit);
}
