// Quick check for download group parsing (animations/comics layout).
// Usage: npx tsx src/__manual__/probe-download-groups.ts
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

const SAMPLE = `
<div class="message-body">
  <b>Download:</b><br>
  <b>Collection:</b> <a href="https://f95zone.to/masked/gofile/1/a/">GOFILE</a> -
  <a href="https://f95zone.to/masked/mega/1/b/">MEGA</a> -
  <a href="https://f95zone.to/masked/mixdrop/1/c/">MIXDROP</a><br>
  <b>08-10:</b> <a href="https://f95zone.to/masked/gofile/1/d/">GOFILE</a> -
  <a href="https://f95zone.to/masked/mixdrop/1/e/">MIXDROP</a><br>
  <b>11-15:</b> <a href="https://f95zone.to/masked/gofile/1/f/">GOFILE</a> -
  <a href="https://f95zone.to/masked/mega/1/g/">MEGA</a><br>
  <b>Win/Linux:</b> <a href="https://f95zone.to/masked/gofile/1/h/">GOFILE</a>
</div>
`;

// Minimal copy of helpers from game.ts for offline verification.
function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const OS_LABEL_RE =
  /\b(win(?:dows)?(?:\s*\/\s*linux)?|linux|mac(?:os)?|android|ios|browser|all platforms?)\b/i;

const GROUP_LABEL_EXCLUDE = new Set([
  'download',
  'downloads',
]);

function normalizeGroupLabel(raw: string): string | null {
  const t = cleanText(raw).replace(/:\s*$/, '').trim();
  if (!t) return null;
  if (GROUP_LABEL_EXCLUDE.has(t.toLowerCase())) return null;
  return t;
}

function labelFromBoldText(raw: string): string | null {
  const t = cleanText(raw);
  if (!t) return null;
  if (OS_LABEL_RE.test(t)) {
    return normalizeGroupLabel(t.endsWith(':') ? t : `${t}:`);
  }
  if (t.endsWith(':')) {
    return normalizeGroupLabel(t);
  }
  return null;
}

function nearestDownloadGroupLabel($: cheerio.CheerioAPI, el: Element): string | null {
  let node: cheerio.Element | null = el;
  let hops = 0;
  while (node && hops < 80) {
    let prev = node.prev ?? null;
    while (prev) {
      if (prev.type === 'tag') {
        const tag = prev.name?.toLowerCase();
        if (tag === 'b' || tag === 'strong') {
          const label = labelFromBoldText($(prev).text());
          if (label) return label;
        }
      } else if (prev.type === 'text') {
        const os = prev.data.match(OS_LABEL_RE);
        if (os) {
          const label = normalizeGroupLabel(os[0]);
          if (label) return label;
        }
      }
      prev = prev.prev ?? null;
      hops++;
    }
    node = node.parent ?? null;
    hops++;
  }
  return null;
}

const $ = cheerio.load(SAMPLE);
const rows: { host: string; group: string | null }[] = [];
$('a[href*="masked"]').each((_, el) => {
  rows.push({
    host: $(el).text().trim(),
    group: nearestDownloadGroupLabel($, el as Element),
  });
});

console.log(JSON.stringify(rows, null, 2));
