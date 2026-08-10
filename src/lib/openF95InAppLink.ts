import { openUrl } from '@tauri-apps/plugin-opener';
import type { NavigateFunction } from 'react-router-dom';
import { pathForForumSearchHit } from './catalogForums';
import { parseF95ContentTarget } from './f95ThreadUrls';
import { resolveF95Url } from './ipc';

const F95_ORIGIN = 'https://f95zone.to';

/** Make site-relative F95 hrefs absolute for parsing / resolve. */
export function absolutizeF95Href(href: string): string {
  const raw = href.trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('/')) return `${F95_ORIGIN}${raw}`;
  return raw;
}

/**
 * Open an href from post/OP HTML in-app when it points at an F95 thread/post.
 * Catalog forums → store game page; everything else → thread reader.
 * Non-thread F95 links and external hosts open in the system browser.
 */
export async function openF95InAppLink(
  href: string,
  navigate: NavigateFunction,
): Promise<void> {
  const absolute = absolutizeF95Href(href);
  if (
    !absolute ||
    absolute.startsWith('#') ||
    absolute.toLowerCase().startsWith('javascript:')
  ) {
    return;
  }

  const target = parseF95ContentTarget(absolute);

  if (target.kind === 'none') return;

  if (target.kind === 'external') {
    await openUrl(target.url);
    return;
  }

  const fetchUrl =
    target.kind === 'post'
      ? `${F95_ORIGIN}/posts/${target.postId}/`
      : target.postId
        ? `${F95_ORIGIN}/posts/${target.postId}/`
        : absolute;

  try {
    const resolved = await resolveF95Url(fetchUrl);
    const forum = resolved.forum?.trim() || '';
    const hintPost = target.kind === 'post' ? target.postId : target.postId;
    const path = pathForForumSearchHit({
      threadId: resolved.threadId,
      forum,
      postId: resolved.postId ?? hintPost,
      page: resolved.page,
    });

    if (path.startsWith('/thread/')) {
      navigate(path, {
        state: forum ? { forum } : undefined,
      });
      return;
    }
    navigate(path);
  } catch {
    await openUrl(absolute);
  }
}
