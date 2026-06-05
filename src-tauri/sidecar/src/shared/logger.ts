export function log(...parts: unknown[]): void {
  const msg = parts
    .map((p) => (typeof p === 'string' ? p : safeStringify(p)))
    .join(' ');
  process.stderr.write(`[f95-bridge] ${msg}\n`);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
