import { BrowserClient } from 'browser-rest-api';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const SESSION_DIR =
  process.env.SESSION_DIR ??
  path.join(process.env.LOCALAPPDATA ?? '', 'com.f95.app', 'sessions');

async function main() {
  const client = new BrowserClient({
    session: 'default',
    sessionDir: SESSION_DIR,
    parseHtml: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const searchUrl =
    'https://f95zone.to/search/?q=%22Hard+to+Love%22+Qori&t=post&c[title_only]=1';
  const res = await client.get(searchUrl);
  console.log('search status', res.status);
  const ids = new Set<string>();
  for (const m of res.body.matchAll(/\/threads\/(?:[^/"']+\.)?(\d+)\//g)) {
    ids.add(m[1]!);
  }
  console.log('thread ids', [...ids].slice(0, 20));

  // Try SAM / latest games page mention
  const candidates = [...ids].slice(0, 8);
  for (const id of candidates) {
    const url = `https://f95zone.to/threads/${id}/`;
    const r = await client.get(url);
    const title = r.body.match(/<title>([^<]+)<\/title>/i)?.[1] ?? '';
    const hasAct2 = /Act\s*2/i.test(r.body) && /Before Remake/i.test(r.body);
    console.log(id, hasAct2 ? 'MATCH' : 'no', title.slice(0, 80));
    if (hasAct2) {
      await fs.writeFile(`thread-${id}.html`, r.body, 'utf8');
      console.log('saved thread-', id);
      break;
    }
  }
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
