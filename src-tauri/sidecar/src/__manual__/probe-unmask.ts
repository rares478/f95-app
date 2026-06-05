// Validate the POST-based unmask flow against a real masked URL.
// Usage:
//   URL="https://f95zone.to/masked/..." npx tsx src/__manual__/probe-unmask.ts
import { BrowserClient } from 'browser-rest-api';
import * as path from 'node:path';

const SESSION_DIR =
  process.env.SESSION_DIR ??
  path.join(process.env.LOCALAPPDATA ?? '', 'com.f95.app', 'sessions');

const MASKED = process.env.URL;
if (!MASKED) {
  console.error('Set URL env var');
  process.exit(2);
}

async function main(): Promise<void> {
  const client = new BrowserClient({
    session: 'default',
    sessionDir: SESSION_DIR,
    parseHtml: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const refMatch = MASKED!.match(/\/masked\/[^/]+\/(\d+)\//);
  const referer = refMatch
    ? `https://f95zone.to/threads/${refMatch[1]}/`
    : 'https://f95zone.to/';

  console.log('[unmask] POST', MASKED);
  const res = await client.post(MASKED!, {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json, text/javascript, */*; q=0.01',
      referer,
      origin: 'https://f95zone.to',
    },
    body: new URLSearchParams({ xhr: '1', download: '1' }).toString(),
  });

  console.log('[unmask] status:', res.status);
  console.log('[unmask] final url:', res.url);
  console.log('[unmask] body bytes:', (res.body ?? '').length);
  console.log('[unmask] body:');
  console.log((res.body ?? '').slice(0, 800));
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
