import { RPC_ERROR, RpcError, type RpcRequest } from './types';

export function parseRequest(line: string): RpcRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new RpcError(RPC_ERROR.PARSE, 'invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new RpcError(RPC_ERROR.INVALID_REQUEST, 'request must be an object');
  }
  const r = parsed as Record<string, unknown>;
  if (r.jsonrpc !== '2.0' || typeof r.id !== 'number' || typeof r.method !== 'string') {
    throw new RpcError(RPC_ERROR.INVALID_REQUEST, 'malformed RPC request');
  }
  return {
    jsonrpc: '2.0',
    id: r.id,
    method: r.method,
    params: (r.params as Record<string, unknown>) ?? {},
  };
}
