// End-to-end check of SocialClient.getFollowing using the persisted session.
import { BrowserClient } from 'browser-rest-api';
import * as path from 'node:path';
import { SocialClient } from '../social';

const SESSION_DIR =
  process.env.SESSION_DIR ??
  path.join(process.env.LOCALAPPDATA ?? '', 'com.f95.app', 'sessions');

async function main(): Promise<void> {
  const http = new BrowserClient({
    session: 'default',
    sessionDir: SESSION_DIR,
    parseHtml: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const client = new SocialClient(http);
  const users = await client.getFollowing();
  console.log(JSON.stringify(users, null, 2));
  console.log(`[smoke] ${users.length} followed user(s)`);
  await http.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
