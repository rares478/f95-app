import * as cheerio from 'cheerio';
import fs from 'fs';
import { resolveDownloadPath } from '../domain/game/client.ts';

const html = fs.readFileSync('thread-93340.html', 'utf8');
const $ = cheerio.load(html);
const op = $('article.message').first().find('.message-body .bbWrapper').first();

const targets = [
  'Eternum-0.9.5-pc.zip', // full pc - not part
  'Eternum-0.9.5-pc.zip.part1.rar',
  'Eternum-0.9.5-mac.zip',
  'Eternum-0.9.5-Android.zip',
];

for (const needle of targets) {
  const a = op.find(`a[href*="${needle}"]`).first();
  if (!a.length) {
    console.log(needle, 'NOT FOUND');
    continue;
  }
  const el = a.get(0)!;
  const path = resolveDownloadPath($, el as any);
  const inSpoiler = $(el).closest('.bbCodeSpoiler').length > 0;
  console.log(needle, { inSpoiler, ...path });
}
