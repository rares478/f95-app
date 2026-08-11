import * as cheerio from 'cheerio';
import fs from 'fs';
import { classifyHost } from '../domain/game/hosts.ts';

const html = fs.readFileSync('thread-93340.html', 'utf8');
const $ = cheerio.load(html);
const op = $('article.message').first().find('.message-body .bbWrapper').first();

// Find text nodes / elements containing "Win/Linux" near downloads
const htmlStr = op.html() || '';
const markers = ['Win/Linux', 'Splits', 'DOWNLOAD', 'Download', 'Android', 'Soundtrack'];
for (const m of markers) {
  const i = htmlStr.indexOf(m);
  console.log(m, 'at', i);
}

// Slice from first Win/Linux-ish download area — search for DATANODES near Win
const re = /Win\/Linux[\s\S]{0,400}/gi;
let match;
let n = 0;
while ((match = re.exec(htmlStr)) && n < 6) {
  console.log('\n--- Win/Linux context', n, '---');
  console.log(match[0].replace(/\s+/g, ' ').slice(0, 350));
  n++;
}

// Dump HTML of spoiler i=6 (45 links)
const spoilers = op.find('.bbCodeSpoiler').toArray();
const s = spoilers[6];
if (s) {
  console.log('\n=== Spoiler 6 outer HTML (first 2500) ===');
  console.log($(s).html()?.slice(0, 2500));
  console.log('\n=== Spoiler 6 previous siblings HTML ===');
  let p: any = s.prev;
  let hops = 0;
  const chunks: string[] = [];
  while (p && hops < 15) {
    if (p.type === 'tag') chunks.unshift($.html(p).slice(0, 300));
    else if (p.type === 'text') chunks.unshift(`#TEXT ${JSON.stringify(p.data)}`);
    p = p.prev;
    hops++;
  }
  console.log(chunks.join('\n---\n'));
}

// Count classified vs all external links
let classified = 0;
let skipped: string[] = [];
op.find('a[href]').each((_, el) => {
  const href = $(el).attr('href') || '';
  const abs = href.startsWith('http') ? href : `https://f95zone.to${href}`;
  const info = classifyHost(abs);
  if (info?.category === 'direct') classified++;
  else {
    try {
      const u = new URL(abs);
      if (!u.hostname.includes('f95zone') && !u.hostname.includes('attachments')) {
        skipped.push(`${u.hostname} ${$(el).text().trim()}`);
      }
    } catch {}
  }
});
console.log('\nclassified direct', classified);
console.log('skipped sample', [...new Set(skipped)].slice(0, 20));
