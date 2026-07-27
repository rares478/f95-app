import { readFileSync } from 'fs';
import * as cheerio from 'cheerio';
import { resolveDownloadPath } from '../domain/game/client.ts';

const html = readFileSync(
  './src/__tests__/fixtures/download-path-dik-patch.html',
  'utf8',
);
const $ = cheerio.load(html);
for (const frag of ['s3-full-win', 'patch-ep11', 'patch-ep10', 's3-p1']) {
  const el = $(`a[href*="${frag}"]`).get(0);
  console.log(frag, resolveDownloadPath($, el as any));
}
