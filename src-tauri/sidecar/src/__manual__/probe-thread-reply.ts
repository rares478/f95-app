// Manual probe: POST a thread reply via GameClient (session required).
// Usage (real post — creates a forum reply):
//   THREAD_ID=284201 MESSAGE="probe" CONFIRM=1 npx tsx src/__manual__/probe-thread-reply.ts
//
// Safe error-shape probe (no post created; posts empty message past client validation):
//   THREAD_ID=284201 ERROR_PROBE=1 npx tsx src/__manual__/probe-thread-reply.ts
import { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import * as path from 'node:path';
import { GameClient } from '../game';
import {
  buildThreadReplyForm,
  parseThreadReplyResponse,
} from '../domain/game/reply';

const SESSION_DIR =
  process.env.SESSION_DIR ??
  path.join(process.env.LOCALAPPDATA ?? '', 'com.f95.app', 'sessions');

const THREAD_ID = process.env.THREAD_ID ?? '';
const MESSAGE = process.env.MESSAGE ?? '';
const ERROR_PROBE = process.env.ERROR_PROBE === '1';
const CONFIRM = process.env.CONFIRM === '1';

async function main(): Promise<void> {
  if (!/^\d+$/.test(THREAD_ID)) {
    console.error('Set THREAD_ID to a numeric thread id.');
    process.exit(1);
  }

  const http = new BrowserClient({
    session: 'default',
    sessionDir: SESSION_DIR,
    parseHtml: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  try {
    if (ERROR_PROBE) {
      await runErrorProbe(http, THREAD_ID);
      return;
    }

    if (!MESSAGE.trim()) {
      console.error('Set MESSAGE, or use ERROR_PROBE=1 for a non-posting shape check.');
      process.exit(1);
    }
    if (!CONFIRM) {
      console.error('Refusing to post without CONFIRM=1 (creates a real F95 reply).');
      process.exit(1);
    }

    const client = new GameClient(http);
    const result = await client.reply(THREAD_ID, MESSAGE);
    console.log('[threadReply] parsed', result);
  } finally {
    await http.close();
  }
}

async function runErrorProbe(
  http: BrowserClient,
  threadId: string,
): Promise<void> {
  const threadUrl = `https://f95zone.to/threads/${threadId}/`;
  console.log('[threadReply] GET', threadUrl);
  const pageRes = await http.get(threadUrl);
  console.log('[threadReply] prep status', pageRes.status, 'url', pageRes.url);

  const $ = cheerio.load(pageRes.body);
  const xfToken =
    $('input[name="_xfToken"]').first().attr('value') ??
    $('html').attr('data-csrf') ??
    null;
  if (!xfToken) {
    throw new Error('could not extract _xfToken');
  }

  // Empty message → XF error JSON without creating a post.
  const form = buildThreadReplyForm({
    threadId,
    message: '',
    xfToken,
    requestUri: `/threads/${threadId}/`,
  });
  console.log('[threadReply] POST (empty message error probe)', form.url);
  const res = await http.post(form.url, {
    headers: form.headers,
    body: form.body,
  });
  console.log('[threadReply] status', res.status);
  console.log('[threadReply] final url', res.url);
  console.log('[threadReply] body bytes', (res.body ?? '').length);
  console.log('[threadReply] raw body', res.body);

  let keys: string[] = [];
  try {
    const parsed = JSON.parse(res.body) as Record<string, unknown>;
    keys = Object.keys(parsed);
    console.log('[threadReply] top-level keys', keys);
  } catch {
    console.log('[threadReply] body is not JSON');
  }

  try {
    const parsed = parseThreadReplyResponse({
      threadId,
      body: res.body,
      finalUrl: res.url,
    });
    console.log('[threadReply] parser unexpectedly succeeded', parsed);
  } catch (e) {
    console.log('[threadReply] parser error', {
      name: (e as Error).name,
      message: (e as Error).message,
      code: (e as { code?: string }).code,
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
