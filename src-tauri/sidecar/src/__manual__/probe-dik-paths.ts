import * as cheerio from 'cheerio';
import fs from 'fs';
import { resolveDownloadPath } from '../domain/game/client.ts';
import { classifyHost } from '../domain/game/hosts.ts';

const html = fs.readFileSync('thread-25332.html', 'utf8');
const $ = cheerio.load(html);
const op = $('article.message').first().find('.message-body .bbWrapper').first();

// Find Patch headings in HTML
const raw = op.html() || '';
const re = /Patch[\s\S]{0,200}/gi;
let m;
let n = 0;
while ((m = re.exec(raw)) && n < 4) {
  console.log('\n--- Patch context', n, '---');
  console.log(m[0].replace(/\s+/g, ' ').slice(0, 280));
  n++;
}

const seasonRe = /Season 3 Interlude[\s\S]{0,150}/gi;
n = 0;
while ((m = seasonRe.exec(raw)) && n < 2) {
  console.log('\n--- Season 3 context', n, '---');
  console.log(m[0].replace(/\s+/g, ' ').slice(0, 250));
  n++;
}

console.log('\n=== Paths for download links near Patch / Season ===');
const rows: { host: string; href: string; path: ReturnType<typeof resolveDownloadPath> }[] = [];
op.find('a[href]').each((_, el) => {
  const href = $(el).attr('href') || '';
  const abs = href.startsWith('http') ? href : `https://f95zone.to${href}`;
  const info = classifyHost(abs);
  if (!info || info.category !== 'direct') return;
  const path = resolveDownloadPath($, el as any);
  rows.push({ host: info.host, href: abs.slice(0, 80), path });
});

const byGroup = new Map<string, number>();
for (const r of rows) {
  const k = `${r.path.kindHint} | ${r.path.group ?? '(null)'}`;
  byGroup.set(k, (byGroup.get(k) ?? 0) + 1);
}
console.log('\n=== Counts ===');
for (const [k, c] of [...byGroup.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${c}\t${k}`);
}

// Sample a few that look like patches (href or nearby)
const patchish = rows.filter(
  (r) =>
    /patch/i.test(r.path.group ?? '') ||
    r.path.kindHint === 'patch' ||
    /0\.11|patch/i.test(r.href),
);
console.log('\n=== Sample patch-related ===');
console.log(JSON.stringify(patchish.slice(0, 8), null, 2));
