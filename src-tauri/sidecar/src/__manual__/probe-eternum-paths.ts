import * as cheerio from 'cheerio';
import fs from 'fs';
import { resolveDownloadPath } from '../domain/game/client.ts';
import { classifyHost } from '../domain/game/hosts.ts';

const html = fs.readFileSync('thread-93340.html', 'utf8');
const $ = cheerio.load(html);
const op = $('article.message').first().find('.message-body .bbWrapper').first();

console.log('=== Spoilers with links ===');
op.find('.bbCodeSpoiler').each((i, el) => {
  const $el = $(el);
  const btnTitle = $el.find('.bbCodeSpoiler-button-title').first().text().trim();
  const btnText = $el.find('button').first().text().trim().slice(0, 80);
  const links = $el.find('a[href]').length;
  if (links === 0) return;

  let prevBits: string[] = [];
  let p: any = el.prev;
  let hops = 0;
  while (p && hops < 10) {
    if (p.type === 'text') {
      const t = (p.data || '').replace(/\s+/g, ' ').trim();
      if (t) prevBits.unshift(`TEXT:${t.slice(0, 60)}`);
    } else if (p.type === 'tag') {
      const t = $(p).text().replace(/\s+/g, ' ').trim().slice(0, 80);
      prevBits.unshift(`${p.name}:${t}`);
    }
    p = p.prev;
    hops++;
  }

  const contentPreview = $el
    .find('.bbCodeSpoiler-content')
    .first()
    .text()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  console.log(
    JSON.stringify(
      { i, btnTitle, btnText, links, prev: prevBits.join(' <- '), contentPreview },
      null,
      2,
    ),
  );
});

console.log('\n=== Download paths for host links ===');
const rows: unknown[] = [];
op.find('a[href]').each((_, el) => {
  const href = $(el).attr('href');
  if (!href) return;
  const info = classifyHost(href.startsWith('http') ? href : `https://f95zone.to${href}`);
  if (!info || info.category !== 'direct') return;
  const path = resolveDownloadPath($, el as any);
  rows.push({
    host: info.host,
    text: $(el).text().trim().slice(0, 40),
    ...path,
  });
});
console.log(JSON.stringify(rows, null, 2));

// Group by group string
const byGroup = new Map<string, number>();
for (const r of rows as { group: string | null }[]) {
  const k = r.group ?? '(null)';
  byGroup.set(k, (byGroup.get(k) ?? 0) + 1);
}
console.log('\n=== Counts by group ===');
for (const [k, n] of [...byGroup.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${n}\t${k}`);
}
