import * as cheerio from 'cheerio';
import fs from 'fs';
import {
  parseDownloadBlock,
  resolveDownloadRoot,
} from '../domain/game/downloadBlock.ts';

const html = fs.readFileSync('thread-93340.html', 'utf8');
const $ = cheerio.load(html);
const op = $('article.message').first().find('.message-body .bbWrapper').first();

const targets = [
  'Eternum-0.9.5-pc.zip', // full pc - not part
  'Eternum-0.9.5-pc.zip.part1.rar',
  'Eternum-0.9.5-mac.zip',
  'Eternum-0.9.5-Android.zip',
];

const root = resolveDownloadRoot($, op as cheerio.Cheerio<cheerio.Element>);
const downloads = root ? parseDownloadBlock($, root) : [];

for (const needle of targets) {
  const hits = downloads.filter((d) => d.url.includes(needle));
  if (!hits.length) {
    console.log(needle, 'NOT FOUND');
    continue;
  }
  console.log(needle, hits);
}
