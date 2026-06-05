export const RPC_ERROR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  INVALID_CREDENTIALS: -32001,
  TWO_FACTOR_REQUIRED: -32002,
  NOT_INITIALIZED: -32003,
  CLOUDFLARE_CHALLENGE: -32010,
} as const;

export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export interface RpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export type RpcResponse =
  | { jsonrpc: '2.0'; id: number; result: unknown }
  | {
      jsonrpc: '2.0';
      id: number;
      error: { code: number; message: string; data?: unknown };
    };

export type RpcHandler = (params: Record<string, unknown>) => Promise<unknown>;
