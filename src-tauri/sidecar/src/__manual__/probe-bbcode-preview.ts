// Manual probe: POST XF misc/bb-code and dump response shape (session required).
// Usage:
//   npx tsx src/__manual__/probe-bbcode-preview.ts
//   BB_CODE='[B]hi[/B]' npx tsx src/__manual__/probe-bbcode-preview.ts
import { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import * as path from 'node:path';
import {
  buildBbcodePreviewForm,
  parseBbcodePreviewResponse,
} from '../domain/game/bbcodePreview';

const SESSION_DIR =
  process.env.SESSION_DIR ??
  path.join(process.env.LOCALAPPDATA ?? '', 'com.f95.app', 'sessions');

const BB_CODE = process.env.BB_CODE ?? '[B]hi[/B]\n[LIST]\n[*]one\n[/LIST]';
const THREAD_ID = process.env.THREAD_ID ?? '207437';

function summarizeKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const pathKey = prefix ? `${prefix}.${k}` : k;
    out.push(`${pathKey}:${Array.isArray(v) ? 'array' : typeof v}`);
    if (v && typeof v === 'object' && !Array.isArray(v) && prefix.split('.').length < 2) {
      out.push(...summarizeKeys(v, pathKey));
    }
  }
  return out;
}

async function main(): Promise<void> {
  const http = new BrowserClient({
    session: 'default',
    sessionDir: SESSION_DIR,
    parseHtml: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  try {
    const accountUrl = 'https://f95zone.to/account/';
    console.log('[bbcodePreview] GET', accountUrl);
    const pageRes = await http.get(accountUrl);
    console.log('[bbcodePreview] prep status', pageRes.status, 'url', pageRes.url);
    if (pageRes.url.includes('/login')) {
      throw new Error('not logged in (session redirected to /login)');
    }

    const $ = cheerio.load(pageRes.body);
    const xfToken =
      $('input[name="_xfToken"]').first().attr('value') ??
      $('html').attr('data-csrf') ??
      null;
    if (!xfToken) {
      throw new Error('could not extract _xfToken');
    }
    console.log('[bbcodePreview] xfToken length', xfToken.length);

    const form = buildBbcodePreviewForm({
      threadId: THREAD_ID,
      bbCode: BB_CODE,
      xfToken,
    });
    console.log('[bbcodePreview] POST', form.url);
    console.log('[bbcodePreview] threadId', THREAD_ID);
    console.log('[bbcodePreview] bbCode sample', JSON.stringify(BB_CODE.slice(0, 80)));

    const res = await http.post(form.url, {
      headers: form.headers,
      body: form.body,
    });
    console.log('[bbcodePreview] status', res.status);
    console.log('[bbcodePreview] final url', res.url);
    console.log('[bbcodePreview] body bytes', (res.body ?? '').length);

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(res.body) as Record<string, unknown>;
      console.log('[bbcodePreview] top-level keys', Object.keys(parsed));
      console.log('[bbcodePreview] key summary', summarizeKeys(parsed));
      if (parsed.html && typeof parsed.html === 'object') {
        console.log(
          '[bbcodePreview] html object keys',
          Object.keys(parsed.html as Record<string, unknown>),
        );
      }
      const snippet =
        typeof parsed.html === 'string'
          ? parsed.html.slice(0, 200)
          : parsed.html &&
              typeof parsed.html === 'object' &&
              typeof (parsed.html as { content?: unknown }).content === 'string'
            ? String((parsed.html as { content: string }).content).slice(0, 200)
            : null;
      if (snippet !== null) {
        console.log('[bbcodePreview] html snippet', snippet);
      }
    } catch {
      console.log('[bbcodePreview] body is not JSON');
      console.log('[bbcodePreview] raw head', String(res.body).slice(0, 500));
    }

    try {
      const html = parseBbcodePreviewResponse(typeof res.body === 'string' ? res.body : '');
      console.log('[bbcodePreview] parser ok, html length', html.length);
      console.log('[bbcodePreview] parser html head', html.slice(0, 240));
    } catch (e) {
      console.log('[bbcodePreview] parser error', {
        name: (e as Error).name,
        message: (e as Error).message,
        code: (e as { code?: string }).code,
      });
      process.exitCode = 1;
    }
  } finally {
    await http.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
