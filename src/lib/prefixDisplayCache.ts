/** Prefix names scraped from thread pages — overrides SAM id lookup when stale. */
const STORAGE_KEY = 'f95-prefix-display-v1';

type Store = Record<string, string[]>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // quota / private mode
  }
}

export function cacheThreadPrefixNames(threadId: string, names: string[]): void {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length === 0) return;
  const store = readStore();
  store[threadId] = cleaned;
  writeStore(store);
}

export function getThreadPrefixNames(threadId: string): string[] | null {
  const names = readStore()[threadId];
  return names && names.length > 0 ? names : null;
}
