export interface WatchedThread {
  threadId: string;
  title: string;
  threadUrl: string;
  forumName: string | null;
  lastActivityAt: string | null;
  isUnreadOnF95: boolean;
}

export interface F95WatchedThreadsResult {
  threads: WatchedThread[];
  page: number;
  hasMore: boolean;
}
