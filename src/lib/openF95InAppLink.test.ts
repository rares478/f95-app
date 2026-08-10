import { describe, expect, it, vi, beforeEach } from 'vitest';
import { absolutizeF95Href, openF95InAppLink } from './openF95InAppLink';

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(async () => undefined),
}));

vi.mock('./ipc', () => ({
  resolveF95Url: vi.fn(),
}));

import { openUrl } from '@tauri-apps/plugin-opener';
import { resolveF95Url } from './ipc';

describe('absolutizeF95Href', () => {
  it('keeps absolute urls and expands site-relative paths', () => {
    expect(absolutizeF95Href('https://f95zone.to/threads/1/')).toBe(
      'https://f95zone.to/threads/1/',
    );
    expect(absolutizeF95Href('/threads/foo.99/')).toBe(
      'https://f95zone.to/threads/foo.99/',
    );
    expect(absolutizeF95Href('//f95zone.to/threads/1/')).toBe(
      'https://f95zone.to/threads/1/',
    );
  });
});

describe('openF95InAppLink', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens catalog threads on the store page', async () => {
    vi.mocked(resolveF95Url).mockResolvedValue({
      threadId: '8012',
      postId: null,
      page: 1,
      forum: 'Games',
    });

    await openF95InAppLink('/threads/milfy.8012/', navigate);

    expect(resolveF95Url).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/store/game/8012?cat=games');
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('opens non-catalog threads on the thread reader', async () => {
    vi.mocked(resolveF95Url).mockResolvedValue({
      threadId: '301555',
      postId: '20628964',
      page: 1,
      forum: 'Dev Tools & Guides',
    });

    await openF95InAppLink(
      'https://f95zone.to/threads/app.301555/post-20628964',
      navigate,
    );

    expect(navigate).toHaveBeenCalledWith('/thread/301555?post=20628964', {
      state: { forum: 'Dev Tools & Guides' },
    });
  });

  it('opens external links in the system browser', async () => {
    await openF95InAppLink('https://example.com/file.zip', navigate);
    expect(openUrl).toHaveBeenCalledWith('https://example.com/file.zip');
    expect(navigate).not.toHaveBeenCalled();
  });
});
