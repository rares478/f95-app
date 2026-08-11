import * as cheerio from 'cheerio';
import fs from 'fs';
import {
  parseDownloadBlock,
  resolveDownloadRoot,
} from '../domain/game/downloadBlock.ts';

const html = fs.readFileSync('thread-25332.html', 'utf8');
const $ = cheerio.load(html);
const op = $('article.message').first().find('.message-body .bbWrapper').first();

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

console.log('\n=== Parsed download block ===');
const root = resolveDownloadRoot($, op as cheerio.Cheerio<cheerio.Element>);
const downloads = root
  ? parseDownloadBlock($, root)
  : [];

const byGroup = new Map<string, number>();
for (const d of downloads) {
  const k = `${d.kindHint} | ${d.group ?? '(null)'}`;
  byGroup.set(k, (byGroup.get(k) ?? 0) + 1);
}
console.log('\n=== Counts ===');
for (const [k, c] of [...byGroup.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${c}\t${k}`);
}

const patchish = downloads.filter(
  (d) =>
    /patch/i.test(d.group ?? '') ||
    d.kindHint === 'patch' ||
    /0\.11|patch/i.test(d.url),
);
console.log('\n=== Sample patch-related ===');
console.log(JSON.stringify(patchish.slice(0, 8), null, 2));
