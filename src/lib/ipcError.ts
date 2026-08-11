import { tStandalone } from './i18n';
import { translateBackendMessage } from './backendMessage';

/** Extract a readable message from Tauri invoke failures (no translation). */
export function extractRawMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.trim()) return o.message;
    if (typeof o.error === 'string' && o.error.trim()) return o.error;
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return String(err);
}

/** Extract and translate a message from Tauri invoke failures for UI display. */
export function formatIpcError(err: unknown): string {
  const raw = extractRawMessage(err);
  return translateBackendMessage(raw, tStandalone);
}
