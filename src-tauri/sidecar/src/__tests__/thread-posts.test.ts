import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractCurrentPageFromHtml,
  parseThreadPostsPage,
} from '../domain/game/posts';

const fix = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('extractCurrentPageFromHtml', () => {
  it('reads the current page from pageNav', () => {
    expect(extractCurrentPageFromHtml(fix('thread-page-2.html'))).toBe(2);
  });

  it('returns 1 when messages exist without page buttons', () => {
    const html = `<html><body>
      <article class="message" data-content="post-9" id="js-post-9">
        <div class="message-body"><div class="bbWrapper">hi</div></div>
      </article>
    </body></html>`;
    expect(extractCurrentPageFromHtml(html)).toBe(1);
  });
});

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
    expect(page.posts[0].html).not.toContain('My cool signature');
    expect(page.posts[0].signatureHtml).toContain('My cool signature');
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
    // Next href /page-3 improves totalPages beyond visible page labels.
    expect(page.totalPages).toBe(3);
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
    expect(page.posts[0].signatureHtml).toBeNull();
  });

  it('ignores /page-N links outside pagination chrome', () => {
    const html = `
      <html><body>
        <nav class="pageNav">
          <ul class="pageNav-main">
            <li class="pageNav-page pageNav-page--current"><a>1</a></li>
            <li class="pageNav-page"><a href="/threads/100/page-2">2</a></li>
          </ul>
        </nav>
        <article class="message" data-content="post-1" id="js-post-1">
          <h4 class="message-name"><a>OP</a></h4>
          <div class="message-body"><div class="bbWrapper">
            <a href="/threads/other.9/page-20899">poison</a>
          </div></div>
        </article>
        <article class="message" data-content="post-2" id="js-post-2">
          <h4 class="message-name"><a>Reply</a></h4>
          <div class="message-body"><div class="bbWrapper"><p>hi</p></div></div>
          <aside class="message-signature">
            <div class="bbWrapper">
              <a href="/threads/sig.1/page-99999">sig</a>
            </div>
          </aside>
        </article>
      </body></html>`;
    const page = parseThreadPostsPage(html, { threadId: '100', page: 1 });
    expect(page.totalPages).toBe(2);
    expect(page.hasMore).toBe(true);
  });
});
