import { RPC_ERROR, RpcError } from '../../rpc';
import { F95_BASE } from '../../shared/constants';

export interface ConversationReplyResult {
  conversationPath: string;
  messageId: string | null;
}

export function buildConversationReplyForm(args: {
  conversationPath: string;
  message: string;
  xfToken: string;
  requestUri: string;
}): { url: string; body: string; headers: Record<string, string> } {
  const path = args.conversationPath.trim().replace(/^\/+|\/+$/g, '');
  const url = `${F95_BASE}/conversations/${path}/insert-reply`;
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

export function buildConversationBbcodePreviewForm(args: {
  conversationPath: string;
  bbCode: string;
  xfToken: string;
  requestUri: string;
}): { url: string; body: string; headers: Record<string, string> } {
  const path = args.conversationPath.trim().replace(/^\/+|\/+$/g, '');
  const url = `${F95_BASE}/conversations/${path}/reply-preview?quick_reply=1`;
  const body = new URLSearchParams({
    message: args.bbCode,
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

function extractMessageIdFromUrl(url: string): string | null {
  const posts = url.match(/\/posts\/(\d+)/);
  if (posts) return posts[1];
  const anchor = url.match(/(?:#message-|#post-|\/message-|\/post-)(\d+)/i);
  return anchor ? anchor[1] : null;
}

export function parseConversationReplyResponse(args: {
  conversationPath: string;
  body: string;
  finalUrl?: string;
}): ConversationReplyResult {
  const conversationPath = args.conversationPath.trim();
  const raw = args.body.trim();
  if (!raw) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'empty conversation reply response from F95');
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
    if (status === 'captcha' || /captcha/i.test(errMsg ?? '')) {
      throw new RpcError(
        RPC_ERROR.CLOUDFLARE_CHALLENGE,
        errMsg ?? 'F95 requires a captcha to reply; open the conversation in your browser',
        { variant: 'recaptcha' },
      );
    }
    if (status === 'error' || (errMsg && status !== 'ok')) {
      throw new RpcError(RPC_ERROR.INTERNAL, errMsg ?? 'conversation reply failed');
    }
    const redirect =
      (typeof parsed.redirect === 'string' && parsed.redirect.trim()) ||
      (typeof parsed.url === 'string' && parsed.url.trim()) ||
      args.finalUrl ||
      '';
    return {
      conversationPath,
      messageId: extractMessageIdFromUrl(redirect) ?? extractMessageIdFromUrl(raw),
    };
  }

  const fromFinal = args.finalUrl ?? '';
  if (/login/i.test(fromFinal)) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  return {
    conversationPath,
    messageId:
      extractMessageIdFromUrl(fromFinal) ??
      (raw.match(/\/posts\/(\d+)/)?.[1] ?? null) ??
      (raw.match(/#message-(\d+)/i)?.[1] ?? null),
  };
}
