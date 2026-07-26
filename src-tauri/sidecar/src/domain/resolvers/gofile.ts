import type { BrowserContext, Page, Response } from 'playwright';
import { RPC_ERROR, RpcError } from '../../rpc';
import { cleanDownloadFileName } from '../../shared/filename';
import { USER_AGENT } from '../../shared/constants';
import { getPlaywrightBrowser } from '../../infra/playwright/browser';

const BASE = 'https://gofile.io';
const UA = USER_AGENT;
const READY_TIMEOUT_MS = 120_000;

export interface ParsedGofileUrl {
  contentId: string;
  pageUrl: string;
}

interface GofileFileEntry {
  type?: string;
  name?: string;
  link?: string;
  size?: number;
}

interface GofileContentsResponse {
  status?: string;
  data?: {
    type?: string;
    name?: string;
    link?: string;
    size?: number;
    children?: Record<string, GofileFileEntry>;
  };
}

export interface GofileFileOption {
  id: string;
  directUrl: string;
  fileName: string;
  fileSize: number | null;
  platformLabel: string | null;
}

export interface GofileResolveResult {
  files: GofileFileOption[];
  extraHeaders: Array<{ name: string; value: string }>;
}

function inferPlatformLabel(fileName: string): string | null {
  const n = fileName.toLowerCase();
  if (n.endsWith('.apk') || n.includes('android')) return 'Android';
  if (n.includes('-mac.') || n.includes('_mac.') || n.includes('macos') || n.endsWith('.dmg')) {
    return 'macOS';
  }
  if (n.includes('-pc.') || n.includes('_pc.') || n.includes('win64') || n.endsWith('.exe')) {
    return 'PC';
  }
  return null;
}

/** Extract content id from /d/<id> or /download/<id> URLs. */
export function parseGofileUrl(raw: string): ParsedGofileUrl {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, `invalid GoFile URL: ${raw}`);
  }
  if (!/^(www\.)?gofile\.io$/i.test(u.hostname)) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, `not a GoFile URL: ${raw}`);
  }
  const segs = u.pathname.split('/').filter(Boolean);
  const idx = segs.findIndex((s) => s === 'd' || s === 'download');
  const contentId =
    (idx >= 0 ? segs[idx + 1] : undefined) ?? segs[segs.length - 1];
  if (!contentId || !/^[a-zA-Z0-9]{4,64}$/.test(contentId)) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'error.gofile.missingId');
  }
  return { contentId, pageUrl: `${BASE}/d/${contentId}` };
}

function allFilesFromContents(body: GofileContentsResponse): GofileFileOption[] {
  const data = body.data;
  if (!data) return [];
  const out: GofileFileOption[] = [];
  const push = (id: string, name: string, link: string, size: number | null) => {
    const fileName = cleanDownloadFileName(name);
    out.push({
      id,
      directUrl: link,
      fileName,
      fileSize: size,
      platformLabel: inferPlatformLabel(fileName),
    });
  };
  if (data.type === 'file' && data.link) {
    const name = data.name?.trim() || 'gofile-download.bin';
    push('file', name, data.link, typeof data.size === 'number' ? data.size : null);
    return out;
  }
  const children = data.children;
  if (!children) return out;
  for (const [childId, entry] of Object.entries(children)) {
    if (entry?.type !== 'file' || !entry.link) continue;
    const name = entry.name?.trim() || 'gofile-download.bin';
    push(childId, name, entry.link, typeof entry.size === 'number' ? entry.size : null);
  }
  out.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { sensitivity: 'base' }));
  return out;
}

async function accountTokenFromContext(context: BrowserContext): Promise<string | null> {
  const cookies = await context.cookies('https://gofile.io');
  const hit = cookies.find((c) => c.name === 'accountToken');
  return hit?.value?.trim() || null;
}

async function sessionHeaders(
  context: BrowserContext,
  referer: string,
): Promise<Array<{ name: string; value: string }>> {
  const headers: Array<{ name: string; value: string }> = [
    { name: 'Referer', value: referer },
    { name: 'User-Agent', value: UA },
  ];
  const token = await accountTokenFromContext(context);
  if (token) {
    headers.unshift({ name: 'Cookie', value: `accountToken=${token}` });
  }
  return headers;
}

function pageNeedsPassword(html: string): boolean {
  return /type=["']password["']/i.test(html) && /password|senha|passwort/i.test(html);
}

function pageIsNotFound(html: string): boolean {
  const lower = html.slice(0, 12_000).toLowerCase();
  return (
    lower.includes('not found') ||
    lower.includes('error-notfound') ||
    lower.includes('content not available') ||
    lower.includes('this content does not exist')
  );
}

/** Wait until the site's JS calls /contents/ and returns status ok. */
function waitForContentsOk(page: Page, contentId: string): Promise<GofileContentsResponse> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      page.off('response', onResponse);
      clearInterval(poll);
      fn();
    };

    const onResponse = async (response: Response) => {
      const url = response.url();
      if (!url.includes('api.gofile.io/contents/') || !url.includes(contentId)) return;
      try {
        const json = (await response.json()) as GofileContentsResponse;
        if (json.status === 'ok') {
          finish(() => resolve(json));
        }
      } catch {
        /* ignore non-json */
      }
    };

    page.on('response', onResponse);

    const poll = setInterval(() => {
      if (Date.now() >= deadline) {
        finish(() =>
          reject(
            new RpcError(
              RPC_ERROR.INTERNAL,
              'error.gofile.metaTimeout',
            ),
          ),
        );
      }
    }, 500);
  });
}

async function resolveViaDownloadClick(
  page: Page,
  fileName: string,
): Promise<{ directUrl: string; fileName: string; fileSize: number | null }> {
  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
  const selectors = [
    '#downloadButton',
    'button#download',
    '.btn-download',
    'button:has-text("Download")',
    'a:has-text("Download")',
    '[data-action="download"]',
  ];
  let clicked = false;
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      await loc.click({ timeout: 15_000 }).catch(() => undefined);
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    throw new RpcError(
      RPC_ERROR.INTERNAL,
      'error.gofile.noButton',
    );
  }
  const download = await downloadPromise;
  const directUrl = download.url();
  if (!directUrl || !directUrl.startsWith('http')) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'error.gofile.noCdn');
  }
  const suggested = download.suggestedFilename();
  await download.cancel().catch(() => undefined);
  return {
    directUrl,
    fileName:
      suggested && suggested.length > 0 ? cleanDownloadFileName(suggested) : fileName,
    fileSize: null,
  };
}

/**
 * GoFile restringiu a API `/contents/` para clientes sem o fluxo do site (X-Website-Token).
 * Playwright carrega a página como o navegador, obtém metadados e cookies de sessão.
 */
export async function resolveGofile(
  url: string,
  presetAccountToken?: string | null,
): Promise<GofileResolveResult> {
  const parsed = parseGofileUrl(url);
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

  if (presetAccountToken?.trim()) {
    await context.addCookies([
      {
        name: 'accountToken',
        value: presetAccountToken.trim(),
        domain: 'gofile.io',
        path: '/',
        secure: true,
        sameSite: 'Lax',
      },
    ]);
  }

  const page = await context.newPage();
  const contentsPromise = waitForContentsOk(page, parsed.contentId);

  try {
    await page.goto(parsed.pageUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    let html = await page.content();
    if (pageIsNotFound(html)) {
      throw new RpcError(RPC_ERROR.INTERNAL, 'error.gofile.notFound');
    }
    if (pageNeedsPassword(html)) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        'error.gofile.password',
      );
    }

    let files: GofileFileOption[] = [];
    try {
      const contents = await contentsPromise;
      files = allFilesFromContents(contents);
    } catch {
      /* fall through to download click */
    }

    if (files.length === 0) {
      html = await page.content();
      if (pageNeedsPassword(html)) {
        throw new RpcError(
          RPC_ERROR.INTERNAL,
          'error.gofile.password',
        );
      }
      const fallbackName =
        (await page.title()).split('|')[0]?.trim() || 'gofile-download.bin';
      const viaClick = await resolveViaDownloadClick(
        page,
        cleanDownloadFileName(fallbackName),
      );
      const fileName = viaClick.fileName;
      files = [
        {
          id: 'download-click',
          directUrl: viaClick.directUrl,
          fileName,
          fileSize: viaClick.fileSize,
          platformLabel: inferPlatformLabel(fileName),
        },
      ];
    }

    return {
      files,
      extraHeaders: await sessionHeaders(context, parsed.pageUrl),
    };
  } catch (err) {
    if (err instanceof RpcError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|timed out/i.test(msg)) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        'error.gofile.browserTimeout',
      );
    }
    throw new RpcError(RPC_ERROR.INTERNAL, 'error.gofile.unknown');
  } finally {
    await context.close().catch(() => undefined);
  }
}
