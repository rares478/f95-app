// Debug helper: reuses the persisted Tauri session to fetch /sam/latest_alpha/,
// dump the HTML, and try candidate JSON-data endpoints used by the page's JS.
// Run: npm --prefix src-tauri/sidecar exec tsx src/__manual__/probe-sam.ts
import { BrowserClient } from 'browser-rest-api';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const SESSION_DIR =
  process.env.SESSION_DIR ??
  path.join(process.env.LOCALAPPDATA ?? '', 'com.f95.app', 'sessions');

const BASE = 'https://f95zone.to';
const PAGE = `${BASE}/sam/latest_alpha/`;

async function main(): Promise<void> {
  const client = new BrowserClient({
    session: 'default',
    sessionDir: SESSION_DIR,
    parseHtml: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  console.log('[page] GET', PAGE);
  const page = await client.get(PAGE);
  console.log('[page] status', page.status, 'final url', page.url);
  await fs.writeFile('sam-page.html', page.body, 'utf8');
  console.log('[page] HTML dumped to sam-page.html');

  // Look for URL-like patterns and JS bootstrap config inside script tags.
  const patterns: { name: string; regex: RegExp }[] = [
    { name: 'latest_data', regex: /latest[_-]?data[^"'\s<>]*\.php[^"'\s<>]*/gi },
    { name: 'data.php', regex: /['"`]([^'"`]*data\.php[^'"`]*)['"`]/g },
    { name: 'data url', regex: /(?:dataUrl|data_url|DATA_URL)\s*[:=]\s*['"`]([^'"`]+)['"`]/g },
    { name: 'fetch(', regex: /fetch\(\s*['"`]([^'"`]+)['"`]/g },
    { name: 'sam_data', regex: /(?:sam[_]?data|samConfig|samBootstrap)\s*=\s*({[\s\S]{0,4000}?});/g },
    { name: 'cmd=list', regex: /cmd=list[^"'\s<>]*/gi },
  ];
  for (const p of patterns) {
    const found = new Set<string>();
    let m: RegExpExecArray | null;
    p.regex.lastIndex = 0;
    while ((m = p.regex.exec(page.body)) !== null) {
      const hit = (m[1] ?? m[0]).slice(0, 400);
      found.add(hit);
      if (found.size >= 6) break;
    }
    console.log(`\n[pattern ${p.name}] ${found.size} hits:`);
    for (const f of found) console.log('  →', f);
  }

  // Try the canonical community-known endpoint variants.
  const candidates = [
    `${BASE}/sam/latest_alpha/data/latest_data.php?cmd=list&cat=games&page=1&sort=date&rows=15`,
    `${BASE}/sam/latest_alpha/data.php?cmd=list&cat=games&page=1&sort=date&rows=15`,
    `${BASE}/sam/latest_alpha/?cmd=list&cat=games&page=1&sort=date&rows=15`,
    `${BASE}/sam/latest_alpha/data/?cmd=list&cat=games&page=1&sort=date&rows=15`,
  ];
  for (const url of candidates) {
    try {
      const r = await client.get(url, { headers: { accept: 'application/json' } });
      const isJson = (r.headers['content-type'] ?? '').toLowerCase().includes('json');
      console.log(
        `\n[candidate] ${url}\n  status=${r.status} json=${isJson} bodyHead="${r.body.slice(0, 200).replace(/\s+/g, ' ')}"`,
      );
      if (r.status === 200 && (isJson || r.body.trim().startsWith('{') || r.body.trim().startsWith('['))) {
        const out = `sam-candidate-${url.replace(/[^a-z0-9]/gi, '_').slice(-80)}.json`;
        await fs.writeFile(out, r.body, 'utf8');
        console.log(`  ✓ saved to ${out}`);
      }
    } catch (err) {
      console.log(`  ✗ ${url} → ${(err as Error).message}`);
    }
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
