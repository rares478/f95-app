import { hasLocaleKey } from './i18n';

const KEY_RE = /^([a-z][a-zA-Z0-9_.]*)$/;

export function parseBackendMessage(
  raw: string,
): { key: string; vars?: Record<string, string | number> } | null {
  const trimmed = raw.trim();
  const pipe = trimmed.indexOf('|');
  const keyPart = pipe === -1 ? trimmed : trimmed.slice(0, pipe);
  if (!KEY_RE.test(keyPart)) return null;
  if (pipe === -1) return { key: keyPart };
  const jsonPart = trimmed.slice(pipe + 1);
  try {
    const parsed = JSON.parse(jsonPart) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const vars: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number') vars[k] = v;
      else return null;
    }
    return { key: keyPart, vars };
  } catch {
    return null;
  }
}

export function translateBackendMessage(
  raw: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
  exists: (key: string) => boolean = hasLocaleKey,
): string {
  const parsed = parseBackendMessage(raw);
  if (!parsed || !exists(parsed.key)) return raw;
  return t(parsed.key, parsed.vars);
}
