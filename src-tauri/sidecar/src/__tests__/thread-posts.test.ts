import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseThreadPostsPage } from '../domain/game/posts';

const fix = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('parseThreadPostsPage', () => {
  it('excludes OP on page 1 and sets hasMore', () => {
    const page = parseThreadPostsPage(fix('thread-page-1.html'), {
      threadId: '100',
      page: 1,
    });
    expect(page.posts).toHaveLength(1);
    expect(page.posts[0].postId).toBe('2');
    expect(page.posts[0].author).toBe('ReplyUser');
    expect(page.posts[0].html).toContain('Hello reply');
    expect(page.hasMore).toBe(true);
    expect(page.totalPages).toBe(2);
  });

  it('keeps all messages on later pages', () => {
    const page = parseThreadPostsPage(fix('thread-page-2.html'), {
      threadId: '100',
      page: 2,
    });
    expect(page.posts.map((p) => p.postId)).toEqual(['3']);
    expect(page.hasMore).toBe(false);
  });

  it('hasMore true when next-jump exists even if visible page nums max at current', () => {
    const page = parseThreadPostsPage(fix('thread-page-2-truncated-nav.html'), {
      threadId: '100',
      page: 2,
    });
    expect(page.totalPages).toBe(2);
    expect(page.hasMore).toBe(true);
  });

  it('falls back to /posts/{id} href when data-content and id lack digits', () => {
    const html = `
      <html><body>
        <article class="message">
          <h4 class="message-name"><a>HrefOnly</a></h4>
          <time class="u-dt" datetime="2020-01-03T00:00:00+0000">Jan 3</time>
          <div class="message-body"><div class="bbWrapper"><p>via href</p></div></div>
          <a href="/posts/99/">Permalink</a>
        </article>
      </body></html>`;
    const page = parseThreadPostsPage(html, { threadId: '100', page: 2 });
    expect(page.posts).toHaveLength(1);
    expect(page.posts[0].postId).toBe('99');
    expect(page.posts[0].author).toBe('HrefOnly');
  });
});
