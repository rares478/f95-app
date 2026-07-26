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
    navigate(storePathForContentTarget(target, cat));
    return;
  }

  // kind === 'post'
  try {
    const { threadId, postId } = await resolvePost(target.postId);
    navigate(storePathForContentTarget({ kind: 'thread', threadId, postId }, cat));
  } catch {
    if (url) await openUrl(url);
  }
}
