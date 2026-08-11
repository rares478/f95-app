import { readFileSync } from 'fs';
import * as cheerio from 'cheerio';
import { parseDownloadBlock } from '../domain/game/downloadBlock.ts';

const html = readFileSync(
  './src/__tests__/fixtures/download-block-kinds.html',
  'utf8',
);
const $ = cheerio.load(html);
const root = $('.download-root').first();
const downloads = parseDownloadBlock($, root as cheerio.Cheerio<cheerio.Element>);
for (const frag of ['kinds-win', 'kinds-patch', 'kinds-extra', 'kinds-p1']) {
  console.log(
    frag,
    downloads.filter((d) => d.url.includes(frag)),
  );
}
