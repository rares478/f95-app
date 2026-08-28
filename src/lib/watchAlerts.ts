import type { F95Alert } from '../types/alerts';
import { parseF95ContentTarget } from './f95ThreadUrls';

/** Thread IDs from unread F95 alerts whose URL maps directly to a thread. */
export function unreadAlertThreadIds(alerts: F95Alert[]): Set<string> {
  const threadIds = new Set<string>();

  for (const alert of alerts) {
    if (!alert.isUnread) continue;

    const target = parseF95ContentTarget(alert.url);
    if (target.kind !== 'thread') continue;

    threadIds.add(target.threadId);
  }

  return threadIds;
}
