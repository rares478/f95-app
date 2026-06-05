// Debug helper: download a single F95Zone thread OP via the persisted session
// and dump structural HTML pieces so we know which selectors to use in the
// GameClient parser. Usage:
//   THREAD_ID=284201 npx tsx src/__manual__/probe-thread.ts
import { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const SESSION_DIR =
  process.env.SESSION_DIR ??
  path.join(process.env.LOCALAPPDATA ?? '', 'com.f95.app', 'sessions');

const THREAD_ID = process.env.THREAD_ID ?? '284201';
const THREAD_URL = `https://f95zone.to/threads/${THREAD_ID}/`;

async function main(): Promise<void> {
  const client = new BrowserClient({
    session: 'default',
    sessionDir: SESSION_DIR,
    parseHtml: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  console.log('[thread] GET', THREAD_URL);
  const res = await client.get(THREAD_URL);
  console.log('[thread] status', res.status, 'final url', res.url);
  await fs.writeFile(`thread-${THREAD_ID}.html`, res.body, 'utf8');

  const $ = cheerio.load(res.body);

  console.log('\n=== p-title-value (title + prefixes) ===');
  console.log($('.p-title-value').first().html()?.slice(0, 600) ?? '<not found>');

  console.log('\n=== first article.message--post (OP) ===');
  const op = $('article.message').first();
  console.log('  data-content:', op.attr('data-content'));
  console.log('  author:', op.find('.message-name').first().text().trim());

  const opBody = op.find('.message-body .bbWrapper').first();
  console.log('  OP bbWrapper length:', opBody.html()?.length ?? 0);
  console.log('  OP first 800 chars HTML:', opBody.html()?.slice(0, 800));

  console.log('\n=== first 5 <img> in OP ===');
  opBody.find('img').slice(0, 5).each((i, el) => {
    const $el = $(el);
    console.log(
      `  [${i}] src="${$el.attr('src')}" data-src="${$el.attr('data-src')}" alt="${$el.attr('alt')}" cls="${$el.attr('class')}"`,
    );
  });

  console.log('\n=== bold labels (potential field keys) ===');
  const labels = new Set<string>();
  opBody.find('b').each((_, el) => {
    const t = $(el).text().trim();
    if (t && t.length < 60 && /[:]\s*$/.test(t)) labels.add(t);
  });
  console.log('  ', Array.from(labels).slice(0, 25));

  console.log('\n=== external <a> hosts (download candidates) ===');
  const hosts = new Map<string, number>();
  opBody.find('a').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    try {
      const u = new URL(href, THREAD_URL);
      if (u.hostname && u.hostname !== 'f95zone.to') {
        hosts.set(u.hostname, (hosts.get(u.hostname) ?? 0) + 1);
      }
    } catch {}
  });
  for (const [h, n] of Array.from(hosts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${h} × ${n}`);
  }

  console.log('\n=== spoiler blocks (changelog/screens often live here) ===');
  opBody.find('.bbCodeSpoiler, .bbCodeBlock--spoiler').each((i, el) => {
    const $el = $(el);
    const btn = $el.find('.bbCodeSpoiler-button-title, .bbCodeBlock-title, button').first().text().trim();
    const imgCount = $el.find('img').length;
    const linkCount = $el.find('a').length;
    console.log(`  [${i}] title="${btn}" imgs=${imgCount} links=${linkCount}`);
  });

  console.log('\n=== tags (.tagList / .js-tagList / footer) ===');
  $('.tagList a, .js-tagList a, dl.tagList dd a').slice(0, 15).each((i, el) => {
    console.log(`  [${i}] ${$(el).text().trim()} → ${$(el).attr('href')}`);
  });

  console.log('\n=== .label spans in title (prefixes) ===');
  $('.p-title-value .label, .p-title-value .labelLink span').each((i, el) => {
    const $el = $(el);
    console.log(`  [${i}] text="${$el.text().trim()}" cls="${$el.attr('class')}"`);
  });

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
