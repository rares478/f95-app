import { useSyncExternalStore } from 'react';
import { query } from './db';

type Listener = () => void;

const listeners = new Set<Listener>();
let cached: Set<string> = new Set();
let loaded = false;
let loadPromise: Promise<void> | null = null;
let revision = 0;

function emit() {
  revision += 1;
  for (const fn of listeners) fn();
}

export function subscribeLibraryMembership(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLibraryMembershipRevision(): number {
  return revision;
}

export function getLibraryThreadIds(): Set<string> {
  return cached;
}

export function isThreadInLibrary(threadId: string): boolean {
  return cached.has(threadId);
}

export async function loadLibraryMembership(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const rows = await query<{ thread_id: string }>(
        `SELECT thread_id FROM library_games`,
      );
      cached = new Set(rows.map((r) => r.thread_id));
      loaded = true;
      emit();
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

export function markThreadInLibrary(threadId: string): void {
  if (cached.has(threadId)) return;
  cached = new Set(cached);
  cached.add(threadId);
  emit();
}

export function markThreadNotInLibrary(threadId: string): void {
  if (!cached.has(threadId)) return;
  cached = new Set(cached);
  cached.delete(threadId);
  emit();
}

/** Reactive membership check for store / more-like cards. */
export function useIsInLibrary(threadId: string): boolean {
  useSyncExternalStore(
    subscribeLibraryMembership,
    getLibraryMembershipRevision,
    () => 0,
  );
  if (!loaded) {
    void loadLibraryMembership();
  }
  return cached.has(threadId);
}
