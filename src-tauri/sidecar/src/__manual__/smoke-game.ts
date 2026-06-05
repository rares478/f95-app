// Sanity check: parse a known thread end-to-end with GameClient.
// Run: THREAD_ID=284201 npx tsx src/__manual__/smoke-game.ts
import { BrowserClient } from 'browser-rest-api';
import * as path from 'node:path';
import { GameClient } from '../game';

const SESSION_DIR =
  process.env.SESSION_DIR ??
  path.join(process.env.LOCALAPPDATA ?? '', 'com.f95.app', 'sessions');

const THREAD_ID = process.env.THREAD_ID ?? '284201';

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
  const detail = await client.getDetail(THREAD_ID);

  // Print everything except the (potentially huge) description.
  const { descriptionHtml, ...rest } = detail;
  console.log(JSON.stringify(rest, null, 2));
  console.log('\n[description bytes]', descriptionHtml.length);
  console.log('[description head]', descriptionHtml.slice(0, 400));

  await http.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
