export type ReviewSort =
  | 'latest'
  | 'helpful'
  | 'newest'
  | 'oldest'
  | 'highest'
  | 'lowest';

export type ThreadReviewsQuery = {
  page?: number;
  sort?: ReviewSort;
  stars?: 1 | 2 | 3 | 4 | 5;
  mention?: string;
  version?: string;
  recent?: boolean;
};

export type ReviewStats = {
  average: number | null;
  count: number | null;
  countLabel: string | null;
  starBars: { stars: number; count: number; percent: number }[];
  parts: { label: string; average: number; countHint: string | null }[];
  mentions: { key: string; label: string; count: number }[];
  monthlyAverage: {
    label: string;
    average: number;
    reviewCount: number;
    leftPct: number;
    widthPct: number;
  }[];
  perMonth: {
    label: string;
    positive: number;
    negative: number;
    inBetween: number;
  }[];
};

export type ReviewHighlight = {
  kind: 'positive' | 'critical' | 'other';
  reviewId: string | null;
  page: number | null;
  href: string | null;
  snippetHtml: string;
  author: string | null;
  rating: number | null;
};

export type ReviewVersionOption = {
  id: string | null;
  name: string;
  dateLabel: string | null;
  statLabel: string | null;
  isCurrent: boolean;
  selected: boolean;
};

export type ReviewCard = {
  reviewId: string;
  author: string;
  authorUserId: string | null;
  authorAvatarUrl: string | null;
  rating: number | null;
  platformLabel: string | null;
  postedAt: string | null;
  edited: boolean;
  parts: { label: string; score: number }[];
  bodyHtml: string;
  helpfulYes: number | null;
  helpfulNo: number | null;
  permalink: string | null;
  authorRecordLabel: string | null;
};

export type ThreadReviewsPage = {
  threadId: string;
  page: number;
  totalPages: number | null;
  hasMore: boolean;
  rangeLabel: string | null;
  sort: string;
  filters: {
    stars: number | null;
    mention: string | null;
    version: string | null;
    recent: boolean;
  };
  stats: ReviewStats | null;
  highlights: ReviewHighlight[];
  versions: ReviewVersionOption[];
  reviews: ReviewCard[];
  reviewsUrl: string;
};
