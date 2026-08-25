import { extractRawMessage } from './ipcError';

const CANCEL_KEY = 'error.extract.cancelled';

/** True when extract_archive stopped because the user cancelled. */
export function isExtractCancelled(err: unknown): boolean {
  const raw = extractRawMessage(err);
  return raw === CANCEL_KEY || raw.startsWith(`${CANCEL_KEY}|`);
}
