import { RPC_ERROR, RpcError } from '../../rpc';
import { F95_BASE } from '../../shared/constants';

export interface BbcodePreviewResult {
  html: string;
}

export function buildBbcodePreviewForm(args: {
  bbCode: string;
  xfToken: string;
  requestUri?: string;
}): { url: string; body: string; headers: Record<string, string> } {
  const requestUri = args.requestUri ?? '/';
  const url = `${F95_BASE}/misc/bb-code`;
  const body = new URLSearchParams({
    bb_code: args.bbCode,
    _xfToken: args.xfToken,
    _xfRequestUri: requestUri,
    _xfWithData: '1',
    _xfResponseType: 'json',
  }).toString();
  return {
    url,
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json, text/javascript, */*; q=0.01',
      referer: `${F95_BASE}${requestUri}`,
      origin: F95_BASE,
    },
  };
}

function firstStringFromErrors(errors: unknown): string | null {
  if (Array.isArray(errors)) {
    for (const item of errors) {
      if (typeof item === 'string' && item.trim()) return item.trim();
    }
    return null;
  }
  if (errors && typeof errors === 'object') {
    for (const value of Object.values(errors as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && item.trim()) return item.trim();
        }
      }
    }
  }
  return null;
}

function firstErrorMessage(parsed: Record<string, unknown>): string | null {
  const fromErrors = firstStringFromErrors(parsed.errors);
  if (fromErrors) return fromErrors;
  if (typeof parsed.message === 'string' && parsed.message.trim()) {
    return parsed.message.trim();
  }
  if (typeof parsed.error === 'string' && parsed.error.trim()) {
    return parsed.error.trim();
  }
  return null;
}

function pickHtmlFragment(parsed: Record<string, unknown>): string | null {
  const html = parsed.html;
  if (html && typeof html === 'object') {
    const content = (html as Record<string, unknown>).content;
    if (typeof content === 'string') return content;
  }
  if (typeof html === 'string') return html;
  for (const key of ['messageHtml', 'templateHtml'] as const) {
    const v = parsed[key];
    if (typeof v === 'string') return v;
  }
  const bbCode = parsed.bbCode;
  if (bbCode && typeof bbCode === 'object') {
    const nested = (bbCode as Record<string, unknown>).html;
    if (typeof nested === 'string') return nested;
  }
  return null;
}

export function parseBbcodePreviewResponse(body: string): string {
  const raw = body.trim();
  if (!raw) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'empty bbcode preview response from F95');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new RpcError(RPC_ERROR.INTERNAL, 'bbcode preview did not return JSON');
  }

  const errMsg = firstErrorMessage(parsed);
  const status = typeof parsed.status === 'string' ? parsed.status : null;
  if (status === 'captcha' || /captcha/i.test(errMsg ?? '')) {
    throw new RpcError(
      RPC_ERROR.CLOUDFLARE_CHALLENGE,
      errMsg ?? 'F95 requires a captcha for BBCode preview; open the site in your browser',
      { variant: 'recaptcha' },
    );
  }
  if (status === 'error' || (errMsg && status !== 'ok')) {
    throw new RpcError(RPC_ERROR.INTERNAL, errMsg ?? 'bbcode preview failed');
  }

  const html = pickHtmlFragment(parsed);
  if (html === null) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'bbcode preview response missing html');
  }
  return html;
}
