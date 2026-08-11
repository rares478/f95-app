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

  const urls = [
    'https://f95zone.to/threads/hard-to-love-v0-28-qori-gaming.207960/',
    'https://f95zone.to/threads/hard-to-love-v0-28-qori-gaming.185000/',
    'https://f95zone.to/threads/hard-to-love-v0-27-qori-gaming.190000/',
    'https://f95zone.to/sam/latest_alpha/',
  ];

  // Use forum search JSON if available
  const q = encodeURIComponent('Hard to Love');
  const search = `https://f95zone.to/search/search?q=${q}&t=post&c[nodes][0]=2&c[title_only]=1&o=date`;
  let res = await client.get(search);
  console.log('search2', res.status, res.url);
  await fs.writeFile('search-htl.html', res.body.slice(0, 200000), 'utf8');
  const titles: string[] = [];
  for (const m of res.body.matchAll(
    /href="(\/threads\/[^"]+)"[^>]*>[\s\S]*?data-preview-url|thread-title--[\s\S]*?href="(\/threads\/[^"]+)"/gi,
  )) {
    titles.push(m[1] || m[2] || '');
  }
  const hrefs = [...res.body.matchAll(/href="(\/threads\/[^"]*hard[^"]*)"/gi)].map(
    (m) => m[1]!,
  );
  console.log('hard hrefs', [...new Set(hrefs)].slice(0, 20));

  // Also try xenforo search finder
  const finder = await client.get(
    'https://f95zone.to/search/?type=post&q=Hard+to+Love+Act+2+Before+Remake',
  );
  console.log('finder', finder.status);
  const fh = [...finder.body.matchAll(/href="(\/threads\/[^"]+)"/gi)]
    .map((m) => m[1]!)
    .filter((h) => /hard/i.test(h));
  console.log('finder hard', [...new Set(fh)].slice(0, 20));

  for (const h of [...new Set([...hrefs, ...fh])].slice(0, 10)) {
    const r = await client.get(`https://f95zone.to${h}`);
    const title = r.body.match(/<title>([^<]+)<\/title>/i)?.[1] ?? '';
    const match =
      /Before Remake/i.test(r.body) && /Act\s*2/i.test(r.body) && /Act\s*1/i.test(r.body);
    console.log(match ? 'YES' : 'no', h, title.slice(0, 70));
    if (match) {
      const id = h.match(/\.(\d+)\//)?.[1] ?? h;
      await fs.writeFile(`thread-htl.html`, r.body, 'utf8');
      console.log('saved as thread-htl.html id~', id);
      break;
    }
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
