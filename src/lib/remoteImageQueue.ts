/**
 * Limita quantas imagens remotas começam a baixar/decodificar ao mesmo tempo
 * (evita travar o scroll quando muitas entram na viewport de uma vez).
 */

export type RemoteImageJob = {
  url: string;
  /** Menor = mais urgente. */
  priority: number;
};

const MAX_CONCURRENT = 2;
const DEBOUNCE_MS = 40;

type Waiter = (url: string) => void;

const ready = new Set<string>();
const waitersByUrl = new Map<string, Waiter[]>();
const inFlight = new Set<string>();

let pending: RemoteImageJob[] = [];
let active = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function enqueue(job: RemoteImageJob) {
  if (ready.has(job.url) || inFlight.has(job.url)) return;
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

function resolveWaiters(url: string) {
  ready.add(url);
  const list = waitersByUrl.get(url);
  if (list) {
    for (const fn of list) fn(url);
    waitersByUrl.delete(url);
  }
}

function pump() {
  while (active < MAX_CONCURRENT && pending.length > 0) {
    sortPending();
    const job = pending.shift()!;
    if (ready.has(job.url)) continue;

    inFlight.add(job.url);
    active += 1;

    const img = new Image();
    const finish = () => {
      inFlight.delete(job.url);
      active -= 1;
      resolveWaiters(job.url);
      pump();
    };

    img.onload = finish;
    img.onerror = finish;
    img.decoding = 'async';
    img.src = job.url;
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

/** Espera até a fila liberar slot; a imagem já foi aquecida no cache do navegador. */
export function requestRemoteImage(url: string, priority = 5): Promise<string> {
  if (ready.has(url)) return Promise.resolve(url);

  return new Promise((resolve) => {
    const list = waitersByUrl.get(url) ?? [];
    list.push(resolve);
    waitersByUrl.set(url, list);
    enqueue({ url, priority });
    schedulePump(priority <= 1);
  });
}

export function prefetchRemoteImage(url: string, priority = 3): void {
  enqueue({ url, priority });
  schedulePump(priority <= 1);
}

export function scheduleRemoteImages(jobs: RemoteImageJob[]): void {
  let urgent = false;
  for (const job of jobs) {
    enqueue(job);
    if (job.priority <= 1) urgent = true;
  }
  schedulePump(urgent);
}

export function clearRemoteImageQueue(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  pending = [];
  inFlight.clear();
  ready.clear();
  waitersByUrl.clear();
  active = 0;
}
