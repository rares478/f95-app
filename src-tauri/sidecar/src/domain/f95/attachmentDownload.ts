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

export interface DownloadPostAttachmentParams {
  /** Present for callers that share F95Client.http; unused for binary bodies. */
  http?: unknown;
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
  } = {},
): Promise<Buffer> {
  const ua = opts.userAgent ?? USER_AGENT;
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

    const res = await fetch(current, {
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

    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  throw new Error('attachment download: too many redirects');
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
