import { convertFileSrc } from '@tauri-apps/api/core';
import { toF95ThumbUrl } from './f95ImageUrl';
import * as ipc from './ipc';

const MAX_CONCURRENT = 1;
const DEBOUNCE_MS = 40;

type Job = { url: string; priority: number };
type Waiter = { resolve: (assetUrl: string) => void; reject: (err: unknown) => void };

const assetUrlCache = new Map<string, string>();
const waitersByUrl = new Map<string, Waiter[]>();
const inFlight = new Set<string>();

let pending: Job[] = [];
let active = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function enqueue(job: Job) {
  if (assetUrlCache.has(job.url) || inFlight.has(job.url)) return;
  const existing = pending.find((p) => p.url === job.url);
  if (existing) {
    if (job.priority < existing.priority) existing.priority = job.priority;
    return;
  }
  pending.push({ ...job });
}

function sortPending() {
  pending.sort((a, b) => a.priority - b.priority);
}

function resolveWaiters(url: string, assetUrl: string) {
  assetUrlCache.set(url, assetUrl);
  const list = waitersByUrl.get(url);
  if (list) {
    for (const w of list) w.resolve(assetUrl);
    waitersByUrl.delete(url);
  }
}

async function worker(job: Job) {
  inFlight.add(job.url);
  try {
    const path = await ipc.resolveRemoteImagePreview({ url: job.url, variant: 'grid' });
    resolveWaiters(job.url, convertFileSrc(path));
  } catch {
    resolveWaiters(job.url, toF95ThumbUrl(job.url));
  } finally {
    inFlight.delete(job.url);
    pending = pending.filter((p) => p.url !== job.url);
    active -= 1;
    pump();
  }
}

function pump() {
  while (active < MAX_CONCURRENT && pending.length > 0) {
    sortPending();
    const job = pending.shift()!;
    if (assetUrlCache.has(job.url)) continue;
    active += 1;
    void worker(job);
  }
}

function schedulePump(urgent: boolean) {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (urgent) {
    debounceTimer = null;
    pump();
    return;
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    pump();
  }, DEBOUNCE_MS);
}

/** Preview ~720px em cache local — melhor que thumb F95, mais leve que HQ. */
export async function requestGridPreview(url: string, priority = 5): Promise<string> {
  const cached = assetUrlCache.get(url);
  if (cached) return cached;

  return new Promise<string>((resolve, reject) => {
    const list = waitersByUrl.get(url) ?? [];
    list.push({ resolve, reject });
    waitersByUrl.set(url, list);
    enqueue({ url, priority });
    schedulePump(priority <= 1);
  });
}

export function clearGridPreviewCache(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  pending = [];
  inFlight.clear();
  assetUrlCache.clear();
  waitersByUrl.clear();
  active = 0;
}
