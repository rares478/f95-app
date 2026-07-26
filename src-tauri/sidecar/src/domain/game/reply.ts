import { RPC_ERROR, RpcError } from '../../rpc';
import { F95_BASE } from '../../shared/constants';
import {
  extractPostIdFromFinal,
  extractThreadPageFromFinal,
} from './posts';

export interface ThreadReplyResult {
  threadId: string;
  postId: string | null;
  page: number | null;
}

export function buildThreadReplyForm(args: {
  threadId: string;
  message: string;
  xfToken: string;
  requestUri: string;
}): { url: string; body: string; headers: Record<string, string> } {
  const id = args.threadId.trim();
  const url = `${F95_BASE}/threads/${id}/add-reply`;
  const body = new URLSearchParams({
    message: args.message,
    _xfToken: args.xfToken,
    _xfRequestUri: args.requestUri,
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
      referer: `${F95_BASE}${args.requestUri}`,
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
  // Live XF often returns field-keyed objects, e.g. { message: "Please enter..." }
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

function pickCandidateUrl(parsed: Record<string, unknown>, finalUrl?: string): string {
  for (const key of ['redirect', 'url', 'messageHref'] as const) {
    const v = parsed[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return finalUrl ?? '';
}

export function parseThreadReplyResponse(args: {
  threadId: string;
  body: string;
  finalUrl?: string;
}): ThreadReplyResult {
  const threadId = args.threadId.trim();
  const raw = args.body.trim();
  if (!raw) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'empty reply response from F95');
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  if (parsed) {
    const errMsg = firstErrorMessage(parsed);
    const status = typeof parsed.status === 'string' ? parsed.status : null;
    // Captcha / challenge first — otherwise generic error branch misclassifies them
    if (status === 'captcha' || /captcha/i.test(errMsg ?? '')) {
      throw new RpcError(
        RPC_ERROR.CLOUDFLARE_CHALLENGE,
        errMsg ?? 'F95 requires a captcha to reply; open the thread in your browser',
        { variant: 'recaptcha' },
      );
    }
    if (status === 'error' || (errMsg && status !== 'ok')) {
      throw new RpcError(RPC_ERROR.INTERNAL, errMsg ?? 'reply failed');
    }
    const candidate = pickCandidateUrl(parsed, args.finalUrl);
    return {
      threadId,
      postId: extractPostIdFromFinal(candidate),
      page: extractThreadPageFromFinal(candidate),
    };
  }

  // HTML fallback: try to find a post permalink in the body / final URL
  const fromFinal = args.finalUrl ?? '';
  const postId =
    extractPostIdFromFinal(fromFinal) ??
    (raw.match(/\/posts\/(\d+)/)?.[1] ?? null) ??
    (raw.match(/#post-(\d+)/i)?.[1] ?? null);
  if (/login/i.test(fromFinal)) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  return {
    threadId,
    postId,
    page: extractThreadPageFromFinal(fromFinal),
  };
}
