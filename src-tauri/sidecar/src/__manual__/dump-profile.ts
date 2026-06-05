// Debug helper: uses the persisted session from the running Tauri app to fetch
// the current user's member page and dump structural HTML so we can fix selectors.
import { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const SESSION_DIR =
  process.env.SESSION_DIR ??
  path.join(
    process.env.LOCALAPPDATA ?? '',
    'com.f95.app',
    'sessions',
  );

async function main(): Promise<void> {
  const client = new BrowserClient({
    session: 'default',
    sessionDir: SESSION_DIR,
    parseHtml: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  // Locate the current user via navbar
  const account = await client.get('https://f95zone.to/account/');
  console.log('[account] status', account.status, 'final url', account.url);
  const $a = cheerio.load(account.body);
  const userLink = $a('.p-navgroup-link--user').first();
  const href = userLink.attr('href') ?? '';
  console.log('[account] user href:', href);

  // Real user id: <html data-user-id> or the avatar class avatar-u<id>-<size>
  let userId = $a('html').attr('data-user-id') ?? null;
  if (!userId) {
    const cls = userLink.find('img').attr('class') ?? '';
    const m = cls.match(/avatar-u(\d+)-/);
    if (m) userId = m[1];
  }
  console.log('[account] resolved userId:', userId);
  const memberUrl = `https://f95zone.to/members/${userId}/`;

  const member = await client.get(memberUrl);
  console.log('[member] status', member.status, 'final url', member.url);
  await fs.writeFile('debug-member.html', member.body, 'utf8');
  console.log('[member] full HTML written to debug-member.html');

  const $ = cheerio.load(member.body);

  console.log('\n=== memberHeader.html (raw) ===');
  console.log($('.memberHeader').first().html()?.slice(0, 4000) ?? '<NOT FOUND>');

  console.log('\n=== all dl on member page ===');
  $('dl').each((i, el) => {
    const $el = $(el);
    const cls = $el.attr('class') ?? '';
    const dt = $el.find('dt').first().text().trim();
    const dd = $el.find('dd').first().text().trim().slice(0, 80);
    console.log(`  [${i}] class="${cls}"  dt="${dt}"  dd="${dd}"`);
  });

  console.log('\n=== userBanner candidates ===');
  $('.userBanner, .userTitle, [class*="memberTooltip-banner"]').each((i, el) => {
    const $el = $(el);
    console.log(
      `  [${i}] tag=${el.tagName} class="${$el.attr('class')}" text="${$el.text().trim().slice(0, 80)}"`,
    );
  });

  console.log('\n=== avatar candidates ===');
  $('.memberHeader img, .p-navgroup-link--user img').each((i, el) => {
    const $el = $(el);
    console.log(
      `  [${i}] class="${$el.attr('class')}" src="${$el.attr('src')}" data-src="${$el.attr('data-src')}"`,
    );
  });

  console.log('\n=== "Joined" / "Last seen" candidates ===');
  $('.memberHeader-extras, .memberHeader-blurb, .memberHeader li').each((i, el) => {
    const $el = $(el);
    console.log(
      `  [${i}] class="${$el.attr('class')}" text="${$el.text().replace(/\s+/g, ' ').trim().slice(0, 200)}"`,
    );
  });

  // Check which activity route exists
  for (const route of ['recent-content', 'recent-activity']) {
    const url = memberUrl.replace(/\/?$/, '/') + route;
    const r = await client.get(url);
    console.log(`\n[${route}] status=${r.status} url=${r.url}`);
    const $r = cheerio.load(r.body);
    const rows = $r('.block-row, .contentRow, li.block-row').length;
    console.log(`  block-row count: ${rows}`);
    const first = $r('.block-row, .contentRow').first();
    if (first.length) {
      console.log('  first row html (snippet):');
      console.log(
        first.html()?.replace(/\s+/g, ' ').slice(0, 600) ?? '<empty>',
      );
    }
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
