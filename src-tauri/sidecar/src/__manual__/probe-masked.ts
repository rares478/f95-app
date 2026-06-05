// Inspect a single F95 /masked/ URL via the persisted session.
// Usage:
//   URL="https://f95zone.to/masked/..." npx tsx src/__manual__/probe-masked.ts
//
// Dumps status, final URL, full body to masked-debug.html, and prints likely
// signals (meta refresh, JS redirects, anchor hrefs to known hosts).
import { BrowserClient } from 'browser-rest-api';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const SESSION_DIR =
  process.env.SESSION_DIR ??
  path.join(process.env.LOCALAPPDATA ?? '', 'com.f95.app', 'sessions');

const MASKED_URL = process.env.URL;
if (!MASKED_URL) {
  console.error('Set URL env var to the masked URL you want to probe.');
  process.exit(2);
}

async function main(): Promise<void> {
  const client = new BrowserClient({
    session: 'default',
    sessionDir: SESSION_DIR,
    parseHtml: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const refMatch = MASKED_URL!.match(/\/masked\/[^/]+\/(\d+)\//);
  const referer = refMatch
    ? `https://f95zone.to/threads/${refMatch[1]}/`
    : 'https://f95zone.to/';

  console.log('[probe] GET', MASKED_URL);
  console.log('[probe] Referer', referer);
  const res = await client.get(MASKED_URL!, { headers: { Referer: referer } });
  console.log('[probe] status', res.status);
  console.log('[probe] final url', res.url);
  console.log('[probe] body bytes', (res.body ?? '').length);
  console.log('[probe] response headers (subset):');
  for (const k of Object.keys(res.headers ?? {})) {
    if (/^(location|content-type|set-cookie|cf-)/i.test(k)) {
      console.log(`    ${k}: ${res.headers[k]}`);
    }
  }

  const body = typeof res.body === 'string' ? res.body : '';
  await fs.writeFile('masked-debug.html', body, 'utf8');
  console.log('[probe] wrote masked-debug.html');

  console.log('\n=== body[0..1500] ===');
  console.log(body.slice(0, 1500));

  // Look for signals
  const meta = body.match(
    /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]+content\s*=\s*["'][^"']*?url=([^"'>\s]+)/i,
  );
  console.log('\n[meta refresh]', meta ? meta[1] : '<none>');

  const js = body.match(
    /(?:window\.|top\.|document\.)?location(?:\.href|\.replace|\.assign)?\s*[=(]\s*["']([^"']+)["']/i,
  );
  console.log('[js location ]', js ? js[1] : '<none>');

  const xfRedirect = body.match(/XF\.redirect\s*\(\s*["']([^"']+)["']/i);
  console.log('[xf redirect ]', xfRedirect ? xfRedirect[1] : '<none>');

  const downloadHostRe =
    /https?:\/\/(?:[a-z0-9-]+\.)*(?:pixeldrain\.com|mega\.(?:nz|co\.nz|io)|mediafire\.com|gofile\.io|workupload\.com|datanodes\.to|buzzheavier\.com|mixdrop\.[a-z]+|rapidgator\.net|1fichier\.com|bunkr\.[a-z]+|cyberfile\.[a-z]+|cyberdrop\.me|anonfiles\.com|nopy\.to)[^"'<>\s]*/gi;
  const hostHits = body.match(downloadHostRe);
  console.log('[host anchors]', hostHits ? hostHits.slice(0, 5) : '<none>');

  // XF2 commonly puts a "you are about to leave" button — anchor with target=_blank and a host URL inside
  const ctaButton = body.match(
    /<a[^>]+class="[^"]*button[^"]*"[^>]+href="([^"]+)"/i,
  );
  console.log('[cta button  ]', ctaButton ? ctaButton[1] : '<none>');

  // Form action (some masked URLs require a POST)
  const form = body.match(/<form[^>]+action="([^"]+)"/i);
  console.log('[form action ]', form ? form[1] : '<none>');

  // Title (helps identify error pages)
  const title = body.match(/<title>([^<]+)<\/title>/i);
  console.log('[title       ]', title ? title[1].trim() : '<none>');

  // h1 / page heading
  const h1 = body.match(/<h1[^>]*>([^<]{2,120})<\/h1>/i);
  console.log('[h1          ]', h1 ? h1[1].trim() : '<none>');

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
