import { openUrl } from '@tauri-apps/plugin-opener';
import type { NavigateFunction } from 'react-router-dom';
import { resolvePost } from './ipc';
import { parseF95ContentTarget, type F95ContentTarget } from './f95ThreadUrls';

export function storePathForContentTarget(
  target: Extract<F95ContentTarget, { kind: 'thread' }>,
  cat = 'games',
): string {
  const q = new URLSearchParams({ cat });
  if (target.postId) q.set('post', target.postId);
  if (target.page != null && target.page > 1) q.set('page', String(target.page));
  return `/store/game/${target.threadId}?${q.toString()}`;
}

export async function openF95NotificationTarget(
  url: string | null,
  navigate: NavigateFunction,
  options?: { category?: string },
): Promise<void> {
  const cat = options?.category ?? 'games';
  const target = parseF95ContentTarget(url);

  if (target.kind === 'none') return;

  if (target.kind === 'external') {
    await openUrl(target.url);
    return;
  }

  if (target.kind === 'thread') {
    // Reply alerts that only name the thread should open near the newest posts.
    if (target.postId == null && target.page == null) {
      navigate(`/store/game/${target.threadId}?cat=${encodeURIComponent(cat)}&page=latest`);
      return;
    }
    navigate(storePathForContentTarget(target, cat));
    return;
  }

  // kind === 'post'
  try {
    const { threadId, postId, page } = await resolvePost(target.postId);
    navigate(
      storePathForContentTarget({ kind: 'thread', threadId, postId, page }, cat),
    );
  } catch {
    if (url) await openUrl(url);
  }
}
