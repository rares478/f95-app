// Manual probe: fetch thread posts via GameClient (session required).
// Usage:
//   THREAD_ID=284201 PAGE=1 npx tsx src/__manual__/probe-thread-posts.ts
import { BrowserClient } from 'browser-rest-api';
import * as path from 'node:path';
import { GameClient } from '../game';

const SESSION_DIR =
  process.env.SESSION_DIR ??
  path.join(process.env.LOCALAPPDATA ?? '', 'com.f95.app', 'sessions');

const THREAD_ID = process.env.THREAD_ID ?? '284201';
const PAGE = Number(process.env.PAGE ?? '1');

async function main(): Promise<void> {
  const http = new BrowserClient({
    session: 'default',
    sessionDir: SESSION_DIR,
    parseHtml: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const client = new GameClient(http);
  const page = await client.getPosts(THREAD_ID, PAGE);

  console.log('[threadPosts] threadId', page.threadId);
  console.log('[threadPosts] page', page.page);
  console.log('[threadPosts] article/reply count', page.posts.length);
  console.log('[threadPosts] hasMore', page.hasMore);
  console.log('[threadPosts] totalPages', page.totalPages);

  const first = page.posts[0];
  if (first) {
    console.log('[threadPosts] first reply', {
      postId: first.postId,
      author: first.author,
      postedAt: first.postedAt,
      htmlBytes: first.html.length,
      permalink: first.permalink,
    });
  } else {
    console.log('[threadPosts] no replies on this page');
  }

  await http.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
