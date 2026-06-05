import type { BrowserClient } from 'browser-rest-api';
import { RPC_ERROR, RpcError } from '../../rpc';
import { F95_BASE } from '../../shared/constants';

export interface UnmaskResponse {
  status?: string;
  msg?: string;
}

export interface UnmaskResult {
  url: string;
  status: number;
}

/** /masked/<host>/<threadId>/<post>/... → the thread page, useful as Referer. */
export function inferRefererFromMasked(url: string): string | null {
  const m = url.match(/^https?:\/\/f95zone\.to\/masked\/[^/]+\/(\d+)\//);
  if (!m) return null;
  return `${F95_BASE}/threads/${m[1]}/`;
}

/** Parse F95 unmask JSON response body. Exported for unit tests. */
export function parseUnmaskResponse(body: string): UnmaskResponse | null {
  try {
    return JSON.parse(body) as UnmaskResponse;
  } catch {
    return null;
  }
}

/**
 * F95's /masked/ URLs serve an interstitial whose masked.js POSTs xhr=1&download=1
 * to reveal the real download URL.
 */
export async function unmaskUrl(http: BrowserClient, url: string): Promise<UnmaskResult> {
  const referer = inferRefererFromMasked(url) ?? `${F95_BASE}/`;
  const res = await http.post(url, {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json, text/javascript, */*; q=0.01',
      referer,
      origin: F95_BASE,
    },
    body: new URLSearchParams({ xhr: '1', download: '1' }).toString(),
  });

  const body = typeof res.body === 'string' ? res.body : '';
  const parsed = parseUnmaskResponse(body);

  if (parsed && typeof parsed.status === 'string') {
    if (parsed.status === 'ok' && typeof parsed.msg === 'string') {
      return { url: parsed.msg, status: res.status };
    }
    if (parsed.status === 'captcha') {
      throw new RpcError(
        RPC_ERROR.CLOUDFLARE_CHALLENGE,
        'F95 requires a reCAPTCHA for this link; open it in your browser',
        { variant: 'recaptcha' },
      );
    }
    if (parsed.status === 'error') {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        `F95 returned an error: ${parsed.msg ?? 'unknown'}`,
      );
    }
  }

  if (/login\b|sign-?in|please\s+log/i.test(body.slice(0, 4000))) {
    throw new RpcError(
      RPC_ERROR.NOT_INITIALIZED,
      'masked URL hit the login page; session expired — please re-login',
    );
  }
  const head = body.slice(0, 240).replace(/\s+/g, ' ').trim();
  throw new RpcError(
    RPC_ERROR.INTERNAL,
    `unmask POST returned non-JSON (status ${res.status}). Body head: ${head}`,
  );
}
