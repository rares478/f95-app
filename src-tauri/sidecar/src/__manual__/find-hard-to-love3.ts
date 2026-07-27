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

  // Games forum latest
  const res = await client.get('https://f95zone.to/forums/games.2/?order=post_date&direction=desc');
  console.log('games forum', res.status);
  const hard = [...res.body.matchAll(/href="(\/threads\/[^"]*hard-to-love[^"]*)"/gi)].map(
    (m) => m[1]!,
  );
  console.log('from latest page', [...new Set(hard)].slice(0, 10));

  // Try direct slug guesses with HEAD/GET
  const guesses = [
    'hard-to-love-v0-28-qori-gaming',
    'hard-to-love-v0-27-qori-gaming',
    'hard-to-love-v0-26-qori-gaming',
    'hard-to-love-qori-gaming',
  ];
  for (const slug of guesses) {
    // xenforo often redirects .ID
    for (const id of [100000, 120000, 140000, 150000, 160000, 170000, 180000, 190000, 200000]) {
      // too many - skip
    }
  }

  // Use Google-less: attachments or bookmarks in DB?
  // Probe known Qori threads via member page
  const member = await client.get('https://f95zone.to/search/?q=Qori+Gaming&t=post&c[users]=Qori&o=date');
  console.log('member search', member.status, member.url);
  const th = [...member.body.matchAll(/\/threads\/([a-z0-9-]+\.\d+)\//gi)].map((m) => m[1]!);
  const uniq = [...new Set(th)].filter((t) => /hard|love|qori/i.test(t));
  console.log('qori threads', uniq.slice(0, 30));

  for (const t of uniq.slice(0, 15)) {
    const r = await client.get(`https://f95zone.to/threads/${t}/`);
    if (/Before Remake/i.test(r.body) && /Act\s*2/i.test(r.body)) {
      await fs.writeFile('thread-htl.html', r.body, 'utf8');
      console.log('FOUND', t);
      break;
    }
    const title = r.body.match(/<title>([^<]+)<\/title>/i)?.[1] ?? '';
    if (/hard to love/i.test(title)) console.log('htl title', t, title.slice(0, 60));
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
