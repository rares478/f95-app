import { convertFileSrc } from '@tauri-apps/api/core';
import {
  THUMB_SKIP_BYTES,
  clearMediaPreviewCache,
  directAssetUrl,
  resolvePreviewPath,
} from './mediaPreview';

export type ThumbJob = {
  path: string;
  size?: number;
  /** Menor = mais urgente (0 = página ativa). */
  priority: number;
};

const MAX_CONCURRENT = 2;
const DEBOUNCE_MS = 50;

const displayUrlByPath = new Map<string, string>();
let storeVersion = 0;
const listeners = new Set<() => void>();

let pending: ThumbJob[] = [];
const inFlightPaths = new Set<string>();
let activeWorkers = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  storeVersion += 1;
  for (const fn of listeners) fn();
}

export function getSidebarThumbUrl(path: string): string | undefined {
  return displayUrlByPath.get(path);
}

export function subscribeSidebarThumbs(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function getSidebarThumbVersion(): number {
  return storeVersion;
}

function tryInstantThumb(path: string, size?: number): boolean {
  if (displayUrlByPath.has(path)) return false;
  if (size === undefined || size > THUMB_SKIP_BYTES) return false;
  displayUrlByPath.set(path, directAssetUrl(path));
  return true;
}

function enqueue(job: ThumbJob): boolean {
  if (displayUrlByPath.has(job.path) || inFlightPaths.has(job.path)) return false;
  if (tryInstantThumb(job.path, job.size)) return true;

  const existing = pending.find((p) => p.path === job.path);
  if (existing) {
    if (job.priority < existing.priority) existing.priority = job.priority;
    return false;
  }
  pending.push({ ...job });
  return false;
}

function sortPending() {
  pending.sort((a, b) => a.priority - b.priority);
}

async function worker(job: ThumbJob) {
  inFlightPaths.add(job.path);
  try {
    const filePath = await resolvePreviewPath(job.path, 'thumb');
    displayUrlByPath.set(job.path, convertFileSrc(filePath));
  } catch {
    displayUrlByPath.set(job.path, directAssetUrl(job.path));
  } finally {
    inFlightPaths.delete(job.path);
    activeWorkers -= 1;
    notify();
    pump();
  }
}

function pump() {
  while (activeWorkers < MAX_CONCURRENT && pending.length > 0) {
    sortPending();
    const job = pending.shift()!;
    if (displayUrlByPath.has(job.path)) continue;
    activeWorkers += 1;
    void worker(job);
  }
}

/** Agenda miniaturas para paths visíveis; prioriza a página ativa e vizinhas. */
export function scheduleSidebarThumbs(jobs: ThumbJob[]) {
  let instant = false;
  let urgent = false;
  for (const job of jobs) {
    if (enqueue(job)) instant = true;
    if (job.priority === 0) urgent = true;
  }
  if (instant) notify();

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

export function clearSidebarThumbCache() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  pending = [];
  inFlightPaths.clear();
  displayUrlByPath.clear();
  activeWorkers = 0;
  notify();
}

export function clearViewerPreviewCaches() {
  clearMediaPreviewCache();
  clearSidebarThumbCache();
}
