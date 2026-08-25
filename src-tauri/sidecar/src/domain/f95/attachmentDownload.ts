import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { USER_AGENT } from '../../shared/constants';
import {
  sanitizeDownloadFileName,
  uniquifyFilePath,
} from '../../shared/downloadFileName';
import { isAllowedAttachmentUrl } from './attachmentUrl';

const MAX_REDIRECTS = 10;
/** Hard ceiling for in-memory attachment bodies (512 MiB). */
export const MAX_ATTACHMENT_BYTES = 512 * 1024 * 1024;

export interface DownloadPostAttachmentParams {
  url: string;
  fileName: string;
  destDir: string;
  /** When set, load cookies from `sessionDir/sessionId.json` for authenticated fetch. */
  sessionDir?: string;
  sessionId?: string;
  userAgent?: string;
  /** Injected binary fetcher (tests). Defaults to session-cookie Node fetch. */
  fetchBinary?: (url: string) => Promise<Uint8Array>;
  exists?: (p: string) => boolean;
  writeFile?: (filePath: string, data: Uint8Array) => Promise<void>;
  mkdir?: (dir: string) => Promise<void>;
}

/**
 * Download an F95 attachment into `destDir` with a sanitized/uniquified name.
 * Uses Node fetch + session cookies (not BrowserClient) so zip bytes stay intact.
 */
export async function downloadPostAttachmentToDir(
  opts: DownloadPostAttachmentParams,
): Promise<{ path: string }> {
  if (!isAllowedAttachmentUrl(opts.url)) {
    throw new Error('attachment url not allowed');
  }

  const safeName = sanitizeDownloadFileName(opts.fileName);
  const exists = opts.exists ?? ((p) => fs.existsSync(p));
  const mkdir = opts.mkdir ?? ((dir) => fsp.mkdir(dir, { recursive: true }).then(() => undefined));
  const writeFile =
    opts.writeFile ??
    ((filePath, data) => fsp.writeFile(filePath, data));

  await mkdir(opts.destDir);
  const destPath = uniquifyFilePath(opts.destDir, safeName, exists);

  const fetchBinary =
    opts.fetchBinary ??
    ((url: string) =>
      fetchAttachmentBinary(url, {
        sessionDir: opts.sessionDir,
        sessionId: opts.sessionId,
        userAgent: opts.userAgent,
      }));

  const body = await fetchBinary(opts.url);
  await writeFile(destPath, body);
  return { path: path.resolve(destPath) };
}

export async function fetchAttachmentBinary(
  url: string,
  opts: {
    sessionDir?: string;
    sessionId?: string;
    userAgent?: string;
    /** Injected fetch (tests). Defaults to global fetch. */
    fetchImpl?: typeof fetch;
    /** Override max body size (tests). Defaults to MAX_ATTACHMENT_BYTES. */
    maxBytes?: number;
  } = {},
): Promise<Buffer> {
  const ua = opts.userAgent ?? USER_AGENT;
  const doFetch = opts.fetchImpl ?? fetch;
  const maxBytes = opts.maxBytes ?? MAX_ATTACHMENT_BYTES;
  let current = url;

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    if (!isAllowedAttachmentUrl(current)) {
      throw new Error(`attachment redirect url not allowed: ${current}`);
    }

    const cookieHeader = await cookieHeaderForUrl(
      current,
      opts.sessionDir,
      opts.sessionId,
    );

    const res = await doFetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'user-agent': ua,
        accept: '*/*',
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) {
        throw new Error(`attachment download redirect ${res.status} without location`);
      }
      current = new URL(loc, current).toString();
      continue;
    }

    if (!res.ok) {
      throw new Error(`attachment download HTTP ${res.status}`);
    }

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('text/html')) {
      throw new Error(
        'attachment download returned HTML (login or error page), not a file',
      );
    }

    const contentLengthRaw = res.headers.get('content-length');
    if (contentLengthRaw != null && contentLengthRaw !== '') {
      const contentLength = Number(contentLengthRaw);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new Error(
          `attachment download exceeds size limit (${contentLength} > ${maxBytes} bytes)`,
        );
      }
    }

    const ab = await res.arrayBuffer();
    if (ab.byteLength > maxBytes) {
      throw new Error(
        `attachment download exceeds size limit (${ab.byteLength} > ${maxBytes} bytes)`,
      );
    }

    const buf = Buffer.from(ab);
    if (looksLikeHtmlBody(buf)) {
      throw new Error(
        'attachment download returned HTML (login or error page), not a file',
      );
    }

    return buf;
  }

  throw new Error('attachment download: too many redirects');
}

/** True when the leading bytes look like an HTML document / login page. */
function looksLikeHtmlBody(buf: Buffer): boolean {
  const head = buf
    .subarray(0, Math.min(buf.length, 512))
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase();
  if (!head) return false;
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return true;
  if (head.includes('<html') && (head.includes('login') || head.includes('<body'))) {
    return true;
  }
  return false;
}

async function cookieHeaderForUrl(
  url: string,
  sessionDir?: string,
  sessionId?: string,
): Promise<string> {
  if (!sessionDir || !sessionId) return '';
  const filePath = path.join(sessionDir, `${sessionId}.json`);
  let raw: string;
  try {
    raw = await fsp.readFile(filePath, 'utf8');
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      (err as { code?: string }).code === 'ENOENT'
    ) {
      return '';
    }
    throw err;
  }

  let parsed: { cookies?: unknown };
  try {
    parsed = JSON.parse(raw) as { cookies?: unknown };
  } catch {
    return '';
  }

  const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
  const host = new URL(url).hostname.toLowerCase();
  const parts: string[] = [];

  for (const entry of cookies) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Record<string, unknown>;
    const key = typeof c.key === 'string' ? c.key : typeof c.name === 'string' ? c.name : null;
    const value = typeof c.value === 'string' ? c.value : null;
    if (!key || value == null) continue;

    const domainRaw = typeof c.domain === 'string' ? c.domain.toLowerCase() : '';
    const domain = domainRaw.replace(/^\./, '');
    if (domain && host !== domain && !host.endsWith(`.${domain}`)) {
      continue;
    }
    parts.push(`${key}=${value}`);
  }

  return parts.join('; ');
}
