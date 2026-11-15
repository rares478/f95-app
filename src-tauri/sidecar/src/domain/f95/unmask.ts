import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
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

export interface F95DlPage {
  actionUrl: string;
  fields: Record<string, string>;
  hasCaptcha: boolean;
}

/** Minimum wait before POSTing the /dl/ form (matches F95 client-side gate). */
export const F95_DL_CODE_DELAY_MS = 2200;

/** /masked/<host>/<threadId>/<post>/... → the thread page, useful as Referer. */
export function inferRefererFromMasked(url: string): string | null {
  const m = url.match(/^https?:\/\/f95zone\.to\/masked\/[^/]+\/(\d+)\//);
  if (!m) return null;
  return `${F95_BASE}/threads/${m[1]}/`;
}

export function isF95DlUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname.toLowerCase() === 'f95zone.to' &&
      /^\/dl\/\d+/i.test(u.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * F95 encodes a one-time form code in `data-code`: strip leading `c`, base64
 * decode, then reverse the string.
 */
export function decodeF95DlCode(encoded: string): string {
  if (!encoded) return '';
  try {
    const b64 = String(encoded).replace(/^c/, '');
    return Buffer.from(b64, 'base64').toString('utf8').split('').reverse().join('');
  } catch {
    return '';
  }
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
 * Extract the Continue form from a `/dl/` interstitial page and populate the
 * decoded code / had_check / CSRF fields the way F95's f95dl-page handler does.
 */
export function parseF95DlPage(html: string, pageUrl: string): F95DlPage | null {
  const $ = cheerio.load(html);
  const $page = $('[data-xf-init~="f95dl-page"]').first();
  if (!$page.length) return null;

  const $button = $page.find('.js-f95dlContinue').first();
  const $form = (
    $button.length && $button.closest('form').length
      ? $button.closest('form')
      : $page.find('form.f95dl-box').first()
  ) as cheerio.Cheerio<Element>;
  if (!$form.length) return null;

  const encoded =
    $page.attr('data-code') || $page.attr('data-f95dl-page-code') || '';
  const decoded = decodeF95DlCode(encoded);

  const fields: Record<string, string> = {};
  $form.find('input[name], textarea[name], select[name]').each((_, el) => {
    const $el = $(el);
    const name = $el.attr('name');
    if (!name) return;
    const type = ($el.attr('type') ?? '').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'image') return;
    if ((type === 'checkbox' || type === 'radio') && !$el.is('[checked]')) return;
    fields[name] = $el.attr('value') ?? '';
  });

  const $code =
    $page.find('.js-f95dlCode').first().length
      ? $page.find('.js-f95dlCode').first()
      : $form.find('.js-f95dlCode').first();
  if ($code.length) {
    const codeName = $code.attr('name') || 'code';
    if (decoded) fields[codeName] = decoded;
  } else if (decoded) {
    fields.code = decoded;
  }

  fields.had_check = '1';

  if (!fields._xfToken) {
    const csrf =
      $('html').attr('data-csrf') ||
      $('input[name="_xfToken"]').first().attr('value') ||
      '';
    if (csrf) fields._xfToken = csrf;
  }

  const actionRaw = $form.attr('action') || pageUrl;
  let actionUrl: string;
  try {
    actionUrl = new URL(actionRaw, pageUrl).href;
  } catch {
    actionUrl = pageUrl;
  }

  const hasCaptcha = Boolean(
    $form.find(
      '.h-captcha, [data-hcaptcha], .g-recaptcha, textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"]',
    ).length,
  );

  return { actionUrl, fields, hasCaptcha };
}

/** Pull the destination hoster URL from a `/dl/` POST HTML response. */
export function parseF95DlGoResponse(html: string): string | null {
  const $ = cheerio.load(html);
  const $go = $('[data-xf-init~="f95dl-go"]').first();
  if (!$go.length) return null;
  const dest =
    $go.attr('data-url') || $go.attr('data-f95dl-go-url') || '';
  if (!/^https?:\/\//i.test(dest)) return null;
  return dest;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function unmaskMaskedUrl(
  http: BrowserClient,
  url: string,
): Promise<UnmaskResult> {
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
  return interpretUnmaskJson(body, res.status);
}

async function unmaskDlUrl(
  http: BrowserClient,
  url: string,
  delayMs: number,
): Promise<UnmaskResult> {
  const getRes = await http.get(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      referer: `${F95_BASE}/`,
    },
  });
  const pageHtml = typeof getRes.body === 'string' ? getRes.body : '';

  if (/login\b|sign-?in|please\s+log/i.test(pageHtml.slice(0, 4000))) {
    throw new RpcError(
      RPC_ERROR.NOT_INITIALIZED,
      'dl URL hit the login page; session expired — please re-login',
    );
  }

  const page = parseF95DlPage(pageHtml, url);
  if (!page) {
    const head = pageHtml.slice(0, 240).replace(/\s+/g, ' ').trim();
    throw new RpcError(
      RPC_ERROR.INTERNAL,
      `could not parse F95 /dl/ interstitial (status ${getRes.status}). Body head: ${head}`,
    );
  }

  if (page.hasCaptcha) {
    throw new RpcError(
      RPC_ERROR.CLOUDFLARE_CHALLENGE,
      'F95 requires a captcha for this link; open it in your browser',
      { variant: 'hcaptcha' },
    );
  }

  if (delayMs > 0) await sleep(delayMs);

  const res = await http.post(page.actionUrl, {
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      referer: url,
      origin: F95_BASE,
    },
    body: new URLSearchParams(page.fields).toString(),
  });

  const body = typeof res.body === 'string' ? res.body : '';

  // Prefer the HTML go-wrapper (current /dl/ response). Fall back to legacy JSON.
  const dest = parseF95DlGoResponse(body);
  if (dest) return { url: dest, status: res.status };

  const asJson = parseUnmaskResponse(body);
  if (asJson && typeof asJson.status === 'string') {
    return interpretUnmaskJson(body, res.status);
  }

  if (/login\b|sign-?in|please\s+log/i.test(body.slice(0, 4000))) {
    throw new RpcError(
      RPC_ERROR.NOT_INITIALIZED,
      'dl POST hit the login page; session expired — please re-login',
    );
  }

  const head = body.slice(0, 240).replace(/\s+/g, ' ').trim();
  throw new RpcError(
    RPC_ERROR.INTERNAL,
    `unmask /dl/ POST returned no destination (status ${res.status}). Body head: ${head}`,
  );
}

function interpretUnmaskJson(body: string, status: number): UnmaskResult {
  const parsed = parseUnmaskResponse(body);

  if (parsed && typeof parsed.status === 'string') {
    if (parsed.status === 'ok' && typeof parsed.msg === 'string') {
      return { url: parsed.msg, status };
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
    `unmask POST returned non-JSON (status ${status}). Body head: ${head}`,
  );
}

/**
 * Resolve an F95 gated download URL to the real hoster link.
 * - `/masked/…` — legacy JSON xhr=1&download=1 POST
 * - `/dl/…` — GET interstitial, decode data-code, POST form, read f95dl-go
 */
export async function unmaskUrl(
  http: BrowserClient,
  url: string,
  opts?: { dlDelayMs?: number },
): Promise<UnmaskResult> {
  if (isF95DlUrl(url)) {
    const delay =
      opts?.dlDelayMs ??
      (process.env.F95_DL_CODE_DELAY_MS
        ? Number(process.env.F95_DL_CODE_DELAY_MS)
        : F95_DL_CODE_DELAY_MS);
    return unmaskDlUrl(http, url, Number.isFinite(delay) ? delay : F95_DL_CODE_DELAY_MS);
  }
  return unmaskMaskedUrl(http, url);
}
