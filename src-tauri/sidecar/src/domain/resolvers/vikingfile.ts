import { RPC_ERROR, RpcError } from '../../rpc';

const HOST_RE = /^(www\.)?(vikingfile\.com|vik1ngfile\.site)$/i;
const HASH_RE = /^[a-zA-Z0-9_-]{6,32}$/;

export interface ParsedVikingfileUrl {
  hash: string;
  pageUrl: string;
}

export function parseVikingfileUrl(raw: string): ParsedVikingfileUrl {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'error.vikingfile.invalidUrl');
  }
  if (!HOST_RE.test(u.hostname)) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'error.vikingfile.invalidUrl');
  }
  const segs = u.pathname.split('/').filter(Boolean);
  const fIdx = segs.findIndex((s) => s.toLowerCase() === 'f');
  const hash = fIdx >= 0 ? segs[fIdx + 1] : segs[0];
  if (!hash || !HASH_RE.test(hash)) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'error.vikingfile.missingHash');
  }
  return {
    hash,
    pageUrl: `https://vikingfile.com/f/${hash}`,
  };
}
