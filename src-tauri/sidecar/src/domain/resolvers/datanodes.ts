import { RPC_ERROR, RpcError } from '../../rpc';

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
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'error.datanodes.invalidUrl');
  }
  if (!/^(www\.)?datanodes\.to$/i.test(u.hostname)) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'error.datanodes.invalidUrl');
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

function normalizeDatanodesFileName(name: string): string {
  return name.trim().replace(/\s+/g, '-');
}
