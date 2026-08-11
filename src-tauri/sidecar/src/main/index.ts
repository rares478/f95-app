import * as readline from 'node:readline';
import { AppContext } from '../domain/context';
import { closePlaywrightBrowser } from '../infra/playwright/browser';
import { log } from '../logger';
import {
  RPC_ERROR,
  RpcError,
  parseRequest,
  type RpcRequest,
  type RpcResponse,
} from '../rpc';
import { createHandlerRegistry, dispatchMethod } from '../rpc/registry';

const ctx = new AppContext();
const handlers = createHandlerRegistry(ctx);

/**
 * Most RPC methods can run concurrently. Serializing everything meant a long
 * Playwright host resolve (DataNodes/Mixdrop/…) blocked samList/gameDetail and
 * froze the Store UI for minutes.
 *
 * Only session lifecycle mutations stay exclusive — they replace `ctx.client`.
 */
const SERIAL_METHODS = new Set(['init', 'login', 'logout', 'close']);

let serialQueue: Promise<void> = Promise.resolve();
const inflight = new Set<Promise<void>>();

function writeResponse(res: RpcResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

async function handleRequest(req: RpcRequest): Promise<void> {
  try {
    const result = await dispatchMethod(handlers, req.method, req.params ?? {});
    writeResponse({ jsonrpc: '2.0', id: req.id, result });
  } catch (err) {
    const e = err as Error;
    if (err instanceof RpcError) {
      writeResponse({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: err.code, message: err.message, data: err.data },
      });
    } else {
      log('handler error:', e.stack ?? e.message);
      writeResponse({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: RPC_ERROR.INTERNAL, message: e.message ?? 'internal error' },
      });
    }
  }
}

function trackInflight(p: Promise<void>): void {
  inflight.add(p);
  void p.finally(() => inflight.delete(p));
}

function dispatch(req: RpcRequest): void {
  if (SERIAL_METHODS.has(req.method)) {
    const p = new Promise<void>((resolve) => {
      serialQueue = serialQueue
        .then(() => handleRequest(req))
        .catch((err) => {
          log('serial queue error:', err);
        })
        .finally(resolve);
    });
    trackInflight(p);
    return;
  }

  trackInflight(handleRequest(req));
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req: RpcRequest;
  try {
    req = parseRequest(trimmed);
  } catch (err) {
    const e = err as RpcError;
    writeResponse({
      jsonrpc: '2.0',
      id: 0,
      error: { code: e.code ?? RPC_ERROR.PARSE, message: e.message },
    });
    return;
  }
  dispatch(req);
});

rl.on('close', () => {
  log('stdin closed, draining in-flight RPCs and exiting');
  void (async () => {
    try {
      await serialQueue;
      await Promise.allSettled([...inflight]);
      if (ctx.client) {
        await ctx.client.close();
        ctx.client = null;
      }
      await closePlaywrightBrowser();
    } catch {
      /* ignore shutdown errors */
    } finally {
      process.exit(0);
    }
  })();
});

process.on('uncaughtException', (err) => {
  log('uncaughtException:', err.stack ?? err.message);
});
process.on('unhandledRejection', (reason) => {
  log('unhandledRejection:', reason);
});

log('ready');
