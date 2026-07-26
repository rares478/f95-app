import type { Download, Page } from 'playwright';
import { RPC_ERROR, RpcError } from '../../rpc';
import { USER_AGENT } from '../../shared/constants';
import { getPlaywrightBrowser } from '../../infra/playwright/browser';

const UA = USER_AGENT;

export interface ParsedDatanodesUrl {
  code: string;
  fileName: string | null;
  navigateUrl: string;
}

/** Extract file code + optional filename from a datanodes.to link. */
export function parseDatanodesUrl(raw: string): ParsedDatanodesUrl {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, `invalid DataNodes URL: ${raw}`);
  }
  if (!/^(www\.)?datanodes\.to$/i.test(u.hostname)) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, `not a DataNodes URL: ${raw}`);
  }
  const segs = u.pathname.split('/').filter(Boolean);
  const isCode = (s: string) =>
    s.length >= 10 && s.length <= 20 && /^[a-zA-Z0-9]+$/.test(s) && /\d/.test(s);
  const skip = new Set(['d', 'download', 'f', 'file', 'embed']);
  let code: string | null = null;
  let fileName: string | null = null;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (skip.has(s.toLowerCase())) continue;
    if (isCode(s)) {
      code = s;
      const next = segs[i + 1];
      if (next && next.includes('.')) fileName = decodeURIComponent(next);
      break;
    }
  }
  if (!code) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'error.datanodes.missingCode');
  }
  const navigateUrl = fileName
    ? `https://datanodes.to/${code}/${encodeURIComponent(normalizeDatanodesFileName(fileName))}`
    : `https://datanodes.to/${code}`;
  return { code, fileName, navigateUrl };
}

/** DataNodes paths use hyphens; F95 links sometimes contain spaces in the filename. */
function normalizeDatanodesFileName(name: string): string {
  return name.trim().replace(/\s+/g, '-');
}

function attachDownloadCapture(page: Page, onUrl: (url: string) => void): void {
  page.on('download', (dl: Download) => {
    const u = dl.url();
    if (u.startsWith('http')) onUrl(u);
  });
}

/**
 * DataNodes free tier opens ad pop-ups on "Continue to Download". We wait for a
 * real browser download event on the main page or any popup. When that fails,
 * callers should ask the user for an API key or open the link in a browser.
 */
export async function resolveDatanodes(url: string): Promise<{
  directUrl: string;
  fileName: string;
  fileSize: number | null;
}> {
  const parsed = parseDatanodesUrl(url);
  const pw = await getPlaywrightBrowser();
  const context = await pw.newContext({ userAgent: UA, acceptDownloads: true });
  const page = await context.newPage();

  let directUrl: string | undefined;
  const capture = (u: string) => {
    if (u.startsWith('http') && !u.includes('itefullofeedshen') && !u.includes('downloadprotector')) {
      directUrl = u;
    }
  };
  attachDownloadCapture(page, capture);
  context.on('page', (popup) => attachDownloadCapture(popup, capture));

  try {
    await page.goto(parsed.navigateUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const bodyText = await page.locator('body').innerText();
    if (/permalink not found|no such file|file not found/i.test(bodyText)) {
      throw new RpcError(RPC_ERROR.INTERNAL, 'error.datanodes.notFound');
    }

    await page.getByText(/4\/4 complete/i).waitFor({ timeout: 120_000 });

    let fileName = parsed.fileName;
    if (!fileName) {
      const m = bodyText.match(/[\w.\-()]+\.(zip|rar|7z|exe|apk|tar|gz|bz2|iso|bin)/i);
      if (m) fileName = m[0];
    }
    if (!fileName) fileName = `${parsed.code}.bin`;

    const btn = page.getByText(/Continue to Download/i);
    if (!(await btn.count())) {
      throw new RpcError(RPC_ERROR.INTERNAL, 'error.datanodes.noButton');
    }

    await btn.click({ force: true });

    for (let i = 0; i < 60 && !directUrl; i++) {
      await page.waitForTimeout(1000);
    }

    if (!directUrl) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        'error.datanodes.needsAds',
      );
    }

    return { directUrl, fileName, fileSize: null };
  } catch (err) {
    if (err instanceof RpcError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|timed out/i.test(msg)) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        'error.datanodes.timeout',
      );
    }
    throw new RpcError(
      RPC_ERROR.INTERNAL,
      `error.datanodes.generic|${JSON.stringify({ detail: msg })}`,
    );
  } finally {
    await context.close().catch(() => undefined);
  }
}
