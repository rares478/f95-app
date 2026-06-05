// Dump /account/following to figure out the row structure for getFollowing.
// Usage: npx tsx src/__manual__/probe-following.ts
import { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const SESSION_DIR =
  process.env.SESSION_DIR ??
  path.join(process.env.LOCALAPPDATA ?? '', 'com.f95.app', 'sessions');
const URL = 'https://f95zone.to/account/following';

async function main(): Promise<void> {
  const client = new BrowserClient({
    session: 'default',
    sessionDir: SESSION_DIR,
    parseHtml: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  console.log('[probe] GET', URL);
  const res = await client.get(URL);
  console.log('[probe] status', res.status, 'final url', res.url);
  await fs.writeFile('following.html', res.body, 'utf8');
  console.log('[probe] saved following.html');

  const $ = cheerio.load(res.body);

  console.log('\n=== <h1> ===');
  console.log($('h1').first().text().trim());

  console.log('\n=== rows (.block-row, .contentRow, .memberCard) — first 4 ===');
  for (const sel of ['.block-row', '.contentRow', '.memberCard', '.structItem']) {
    const n = $(sel).length;
    console.log(`  ${sel}: ${n}`);
  }

  console.log('\n=== first .block-row ===');
  console.log($('.block-row').first().html()?.slice(0, 1500) ?? '<empty>');

  console.log('\n=== <a href="/members/..."> in main area ===');
  $('.p-body-main a[href*="/members/"]').slice(0, 8).each((i, el) => {
    const $el = $(el);
    console.log(
      `  [${i}] href=${$el.attr('href')} text="${$el.text().trim().slice(0, 60)}"`,
    );
  });

  console.log('\n=== avatars ===');
  $('.p-body-main img.avatar, .p-body-main .avatar img').slice(0, 6).each((i, el) => {
    const $el = $(el);
    console.log(
      `  [${i}] cls="${$el.attr('class')}" src="${$el.attr('src')}" alt="${$el.attr('alt')}"`,
    );
  });

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
