import type { BrowserContext, Page } from 'playwright';
import * as cheerio from 'cheerio';
import { RPC_ERROR, RpcError } from '../../rpc';
import { cleanDownloadFileName } from '../../shared/filename';
import { isBotChallengePage, isCloudflareInterstitial } from '../../shared/cloudflare';
import { USER_AGENT } from '../../shared/constants';
import { getPlaywrightBrowser } from '../../infra/playwright/browser';

const BASE = 'https://workupload.com';
const UA = USER_AGENT;
const READY_TIMEOUT_MS = 120_000;

export interface ParsedWorkuploadUrl {
  fileId: string;
  fileName: string | null;
  pageUrl: string;
}

/** Parse workupload.com/file/{id} or /file/{id}/{filename}. */
export function parseWorkuploadUrl(raw: string): ParsedWorkuploadUrl {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, `invalid WorkUpload URL: ${raw}`);
  }
  if (!/^(www\.)?workupload\.com$/i.test(u.hostname)) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, `not a WorkUpload URL: ${raw}`);
  }
  const segs = u.pathname.split('/').filter(Boolean);
  const fileIdx = segs.findIndex((s) => s.toLowerCase() === 'file');
  if (fileIdx === -1 || !segs[fileIdx + 1]) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'error.workupload.missingId');
  }
  const fileId = segs[fileIdx + 1];
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(fileId)) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, `invalid WorkUpload file id: ${fileId}`);
  }
  const nameSeg = segs[fileIdx + 2];
  const fileName = nameSeg ? decodeURIComponent(nameSeg) : null;
  const pageUrl = fileName
    ? `${BASE}/file/${fileId}/${encodeURIComponent(fileName)}`
    : `${BASE}/file/${fileId}`;
  return { fileId, fileName, pageUrl };
}

interface DownloadServerResponse {
  status?: number;
  data?: { url?: string; name?: string; size?: number | string };
  msg?: string;
}

export interface WorkuploadResolveResult {
  directUrl: string;
  fileName: string;
  fileSize: number | null;
  extraHeaders: Array<{ name: string; value: string }>;
}

/** Cookies + Referer from the Playwright session — required by WorkUpload CDN. */
async function sessionHeaders(
  context: BrowserContext,
  referer: string,
): Promise<Array<{ name: string; value: string }>> {
  const all = await context.cookies();
  const relevant = all.filter((c) => c.domain.includes('workupload.com'));
  const headers: Array<{ name: string; value: string }> = [
    { name: 'Referer', value: referer },
    { name: 'User-Agent', value: UA },
  ];
  if (relevant.length > 0) {
    const cookieHeader = relevant.map((c) => `${c.name}=${c.value}`).join('; ');
    headers.unshift({ name: 'Cookie', value: cookieHeader });
  }
  return headers;
}

async function withSessionHeaders(
  context: BrowserContext,
  referer: string,
  result: { directUrl: string; fileName: string; fileSize: number | null },
): Promise<WorkuploadResolveResult> {
  return {
    ...result,
    extraHeaders: await sessionHeaders(context, referer),
  };
}

function pageIsNotFound(status: number | null, html: string): boolean {
  if (status === 404) return true;
  const lower = html.slice(0, 8000).toLowerCase();
  return (
    lower.includes('file not found') ||
    (lower.includes('not found') && lower.includes('workupload')) ||
    lower.includes('this file does not exist') ||
    lower.includes('file has been deleted')
  );
}

function looksLikeFilePage(html: string): boolean {
  const lower = html.slice(0, 20_000).toLowerCase();
  return (
    lower.includes('getdownloadserver') ||
    lower.includes('/start/') ||
    lower.includes('download file') ||
    lower.includes('download now') ||
    /<a[^>]+href=["'][^"']*\/start\//i.test(html)
  );
}

function extractFileName(html: string, parsed: ParsedWorkuploadUrl): string | null {
  if (parsed.fileName) return cleanDownloadFileName(parsed.fileName);
  const $ = cheerio.load(html);
  const og = $('meta[property="og:title"]').attr('content')?.trim();
  if (og && og.length > 0 && !/workupload/i.test(og)) return cleanDownloadFileName(og);
  const h1 = $('h1').first().text().trim();
  if (h1 && h1.length > 0 && !/human|security check/i.test(h1)) return cleanDownloadFileName(h1);
  const title = $('title').text().split('|')[0]?.trim();
  if (title && title.length > 0 && !/^workupload/i.test(title) && !/human/i.test(title)) {
    return cleanDownloadFileName(title);
  }
  return null;
}

function challengeError(): RpcError {
  return new RpcError(
    RPC_ERROR.CLOUDFLARE_CHALLENGE,
    'error.workupload.challenge',
  );
}

function assertNotChallengeHtml(html: string): void {
  if (isBotChallengePage(html)) {
    throw challengeError();
  }
}

/** Poll until WorkUpload's JS bot-check finishes and the file page is visible. */
async function waitForFilePage(page: Page): Promise<string> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastHtml = '';

  while (Date.now() < deadline) {
    lastHtml = await page.content();
    if (!isBotChallengePage(lastHtml) && looksLikeFilePage(lastHtml)) {
      return lastHtml;
    }
    if (!isBotChallengePage(lastHtml) && !pageIsNotFound(null, lastHtml)) {
      // Page loaded but no obvious download UI yet — give JS a moment.
      await page.waitForTimeout(2000);
      lastHtml = await page.content();
      if (!isBotChallengePage(lastHtml)) return lastHtml;
    }
    await page.waitForTimeout(1500);
  }

  if (isBotChallengePage(lastHtml)) throw challengeError();
  return lastHtml;
}

async function fetchDownloadServer(
  page: Page,
  fileId: string,
): Promise<DownloadServerResponse> {
  return page.evaluate(async (id) => {
    const res = await fetch(`/api/file/getDownloadServer/${id}`, {
      credentials: 'include',
      headers: { accept: 'application/json, text/plain, */*' },
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as DownloadServerResponse;
    } catch {
      return { status: res.status, msg: text.slice(0, 400) };
    }
  }, fileId);
}

async function resolveViaApi(
  page: Page,
  parsed: ParsedWorkuploadUrl,
  fileName: string,
): Promise<{ directUrl: string; fileName: string; fileSize: number | null } | null> {
  await page
    .goto(`${BASE}/start/${parsed.fileId}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    .catch(() => undefined);

  const api = await fetchDownloadServer(page, parsed.fileId);
  const rawMsg = api?.msg ?? '';
  if (rawMsg && isBotChallengePage(rawMsg)) return null;

  const directUrl = api?.data?.url?.trim();
  if (!directUrl || !directUrl.startsWith('http')) return null;

  let fileSize: number | null = null;
  const rawSize = api.data?.size;
  if (typeof rawSize === 'number' && Number.isFinite(rawSize)) {
    fileSize = rawSize;
  } else if (typeof rawSize === 'string') {
    const n = parseInt(rawSize, 10);
    if (Number.isFinite(n)) fileSize = n;
  }

  const apiName = api.data?.name?.trim();
  return {
    directUrl,
    fileName: apiName && apiName.length > 0 ? cleanDownloadFileName(apiName) : fileName,
    fileSize,
  };
}

async function resolveViaDownloadClick(
  page: Page,
  parsed: ParsedWorkuploadUrl,
  fileName: string,
): Promise<{ directUrl: string; fileName: string; fileSize: number | null }> {
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });

  const selectors = [
    `a[href="/start/${parsed.fileId}"]`,
    `a[href*="/start/${parsed.fileId}"]`,
    'a.btn-download',
    'button:has-text("Download")',
    'a:has-text("Download")',
  ];

  let clicked = false;
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      await loc.click({ timeout: 10_000 }).catch(() => undefined);
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    await page
      .goto(`${BASE}/start/${parsed.fileId}`, { waitUntil: 'load', timeout: 45_000 })
      .catch(() => undefined);
  }

  const download = await downloadPromise;
  const directUrl = download.url();
  if (!directUrl || !directUrl.startsWith('http')) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'error.workupload.noCdn');
  }
  const suggested = download.suggestedFilename();
  await download.cancel().catch(() => undefined);
  return {
    directUrl,
    fileName: suggested && suggested.length > 0 ? cleanDownloadFileName(suggested) : fileName,
    fileSize: null,
  };
}

/**
 * WorkUpload runs a JS bot-check ("Are you a human?") before the file page loads.
 * We wait for that to finish in Playwright, then resolve via API or download click.
 */
export async function resolveWorkupload(url: string): Promise<WorkuploadResolveResult> {
  const parsed = parseWorkuploadUrl(url);
  const pw = await getPlaywrightBrowser();
  const context = await pw.newContext({
    userAgent: UA,
    acceptDownloads: true,
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
  });
  await context.addInitScript(
    "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });",
  );
  const page = await context.newPage();

  try {
    await page.goto(parsed.pageUrl, { waitUntil: 'load', timeout: 90_000 });

    let html = await waitForFilePage(page);
    assertNotChallengeHtml(html);

    if (pageIsNotFound(null, html)) {
      throw new RpcError(RPC_ERROR.INTERNAL, 'error.workupload.notFound');
    }
    if (/password|passwort|senha/i.test(html) && /type=["']password["']/i.test(html)) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        'error.workupload.password',
      );
    }

    const fileName = extractFileName(html, parsed) ?? `${parsed.fileId}.bin`;

    const viaApi = await resolveViaApi(page, parsed, fileName);
    // Must await before finally closes the context (return without await races finally).
    if (viaApi) return await withSessionHeaders(context, parsed.pageUrl, viaApi);

    // API blocked or returned HTML — try browser download event (same session/cookies).
    try {
      const viaClick = await resolveViaDownloadClick(page, parsed, fileName);
      return await withSessionHeaders(context, parsed.pageUrl, viaClick);
    } catch (clickErr) {
      if (clickErr instanceof RpcError && clickErr.code === RPC_ERROR.CLOUDFLARE_CHALLENGE) {
        throw clickErr;
      }
      html = await page.content();
      if (isBotChallengePage(html)) throw challengeError();
      const msg = clickErr instanceof Error ? clickErr.message : String(clickErr);
      if (/timeout|timed out/i.test(msg)) throw challengeError();
      throw clickErr;
    }
  } catch (err) {
    if (err instanceof RpcError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|timed out/i.test(msg) || isBotChallengePage(msg)) {
      throw challengeError();
    }
    throw new RpcError(
      RPC_ERROR.INTERNAL,
      `error.workupload.generic|${JSON.stringify({ detail: msg })}`,
    );
  } finally {
    await context.close().catch(() => undefined);
  }
}
